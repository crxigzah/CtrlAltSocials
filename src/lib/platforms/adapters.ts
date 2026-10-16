import "server-only";
import type { PlatformId } from "@/lib/platforms/catalog";

// Server-side integrations for the live platforms. Each adapter checks credentials
// when an account is connected, and publishes a text post with them later.

export type PublishResult = { url: string | null };

type Adapter<C> = {
  /** Validates what the user typed in the connect form; returns credentials to store and a default label. */
  connect(input: FormData): Promise<{ credentials: C; label: string }>;
  publish(credentials: C, text: string): Promise<PublishResult>;
};

class PlatformError extends Error {}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.error || text;
  } catch {
    return text || res.statusText;
  }
}

// --- Bluesky -----------------------------------------------------------------

type BlueskyCredentials = { identifier: string; appPassword: string; service: string };

const BSKY_SERVICE = "https://bsky.social";
const APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

async function blueskySession(c: BlueskyCredentials) {
  const res = await fetch(`${c.service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: c.identifier, password: c.appPassword }),
    cache: "no-store",
  });
  if (!res.ok) throw new PlatformError(`Bluesky sign-in failed: ${await readError(res)}`);
  return (await res.json()) as { accessJwt: string; did: string; handle: string };
}

const encoder = new TextEncoder();

/** Links and hashtags only become clickable on Bluesky when sent as facets with UTF-8 byte offsets. */
function blueskyFacets(text: string) {
  const facets: object[] = [];
  const byteIndex = (charIndex: number) => encoder.encode(text.slice(0, charIndex)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g)) {
    facets.push({
      index: { byteStart: byteIndex(m.index!), byteEnd: byteIndex(m.index! + m[0].length) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }],
    });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const start = m.index! + m[1].length;
    facets.push({
      index: { byteStart: byteIndex(start), byteEnd: byteIndex(start + 1 + m[2].length) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }],
    });
  }
  return facets;
}

const bluesky: Adapter<BlueskyCredentials> = {
  async connect(input) {
    const identifier = String(input.get("identifier") ?? "").trim().replace(/^@/, "");
    const appPassword = String(input.get("app_password") ?? "").trim().toLowerCase();
    if (!identifier) throw new PlatformError("Enter the account's handle, e.g. 5kable.bsky.social.");
    if (!APP_PASSWORD.test(appPassword)) {
      throw new PlatformError("That doesn't look like an app password (xxxx-xxxx-xxxx-xxxx). Create one in Bluesky's settings; don't use the main password.");
    }
    const credentials = { identifier, appPassword, service: BSKY_SERVICE };
    const session = await blueskySession(credentials);
    return { credentials, label: `@${session.handle}` };
  },
  async publish(c, text) {
    const session = await blueskySession(c);
    const facets = blueskyFacets(text);
    const res = await fetch(`${c.service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text,
          createdAt: new Date().toISOString(),
          ...(facets.length ? { facets } : {}),
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new PlatformError(`Bluesky rejected the post: ${await readError(res)}`);
    const { uri } = (await res.json()) as { uri: string };
    const rkey = uri.split("/").pop();
    return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  },
};

// --- Discord -----------------------------------------------------------------

type DiscordCredentials = { webhookUrl: string; guildId?: string };

function parseWebhook(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PlatformError("Paste the full webhook URL from Discord.");
  }
  const okHost = ["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(url.hostname);
  if (url.protocol !== "https:" || !okHost || !/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)) {
    throw new PlatformError("That isn't a Discord webhook URL (https://discord.com/api/webhooks/…).");
  }
  return `https://discord.com${url.pathname.replace(/\/$/, "")}`;
}

const discord: Adapter<DiscordCredentials> = {
  async connect(input) {
    const webhookUrl = parseWebhook(String(input.get("webhook_url") ?? ""));
    const res = await fetch(webhookUrl, { cache: "no-store" });
    if (!res.ok) throw new PlatformError(`Discord didn't recognise that webhook: ${await readError(res)}`);
    const hook = (await res.json()) as { name?: string; guild_id?: string };
    return { credentials: { webhookUrl, guildId: hook.guild_id }, label: hook.name ? `${hook.name} (webhook)` : "Discord webhook" };
  },
  async publish(c, text) {
    const res = await fetch(`${c.webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Never let a post ping @everyone or roles by accident.
      body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      cache: "no-store",
    });
    if (!res.ok) throw new PlatformError(`Discord rejected the post: ${await readError(res)}`);
    const msg = (await res.json()) as { id: string; channel_id: string };
    return { url: c.guildId ? `https://discord.com/channels/${c.guildId}/${msg.channel_id}/${msg.id}` : null };
  },
};

// -----------------------------------------------------------------------------

const ADAPTERS: Partial<Record<PlatformId, Adapter<never>>> = {
  bluesky: bluesky as Adapter<never>,
  discord: discord as Adapter<never>,
};

export function getAdapter(platform: string) {
  return ADAPTERS[platform as PlatformId] as Adapter<unknown> | undefined;
}

/** Message safe to show the user: platform errors verbatim, anything else generic. */
export function describeError(err: unknown): string {
  if (err instanceof PlatformError) return err.message.slice(0, 500);
  console.error(err);
  return "Something went wrong talking to the platform. Try again in a minute.";
}
