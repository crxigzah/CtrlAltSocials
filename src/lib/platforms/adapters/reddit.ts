import "server-only";
import { PlatformError, readError, requireEnv, type OAuthAdapter } from "./shared";

// Reddit: posts to one subreddit per connected account (set on the Accounts tab).
// The first line becomes the title and the rest the body; a post whose body is just
// a link goes up as a link post. Access tokens last an hour; the refresh token doesn't expire.

export type RedditCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  username: string;
  subreddit?: string;
};

const USER_AGENT = "web:ctrlaltsocials:v0.1 (self-hosted social scheduler)";

function basicAuth() {
  return "Basic " + Buffer.from(`${requireEnv("REDDIT_CLIENT_ID")}:${requireEnv("REDDIT_CLIENT_SECRET")}`).toString("base64");
}

async function token(params: Record<string, string>) {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: basicAuth(), "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    const reason = json.error ?? res.statusText;
    throw new PlatformError(params.grant_type === "refresh_token" ? `Reddit sign-in expired (${reason}). Reconnect the account.` : `Reddit sign-in failed: ${reason}`);
  }
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Splits a post into Reddit's title (first line, max 300) and body (the rest). */
export function redditParts(text: string) {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim());
  const title = first === -1 ? "" : [...lines[first].trim()].slice(0, 300).join("");
  const body = first === -1 ? "" : lines.slice(first + 1).join("\n").trim();
  return { title, body, link: /^https?:\/\/\S+$/.test(body) ? body : null };
}

export const SUBREDDIT_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

export const reddit: OAuthAdapter<RedditCredentials> = {
  kind: "oauth",
  env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const url = new URL("https://www.reddit.com/api/v1/authorize");
    url.searchParams.set("client_id", requireEnv("REDDIT_CLIENT_ID"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("duration", "permanent");
    url.searchParams.set("scope", "identity submit");
    return url.toString();
  },

  async exchange({ code, redirectUri }) {
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (!t.refresh_token) throw new PlatformError("Reddit didn't return a refresh token.");
    const res = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: { Authorization: `Bearer ${t.access_token}`, "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    if (!res.ok) throw new PlatformError(`Reddit profile lookup failed: ${await readError(res)}`);
    const me = (await res.json()) as { id: string; name: string };
    return {
      credentials: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000, userId: me.id, username: me.name },
      label: `u/${me.name}`,
      remoteId: me.id,
    };
  },

  async publish(c, text) {
    if (!c.subreddit) throw new PlatformError("Pick which subreddit this account posts to on the Accounts tab.");
    const { title, body, link } = redditParts(text);
    if (!title) throw new PlatformError("Reddit posts need a title: the first line of the post.");

    let creds = c;
    let refreshed: RedditCredentials | undefined;
    if (c.expiresAt - Date.now() < 5 * 60 * 1000) {
      const t = await token({ grant_type: "refresh_token", refresh_token: c.refreshToken });
      refreshed = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token ?? c.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
      creds = refreshed;
    }

    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_type: "json",
        sr: creds.subreddit!,
        title,
        ...(link ? { kind: "link", url: link } : { kind: "self", text: body }),
        resubmit: "true",
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as { json?: { errors?: [string, string, string][]; data?: { url?: string } } } | null;
    const errors = json?.json?.errors ?? [];
    if (!res.ok || errors.length) {
      const reason = errors.map((e) => e[1]).join("; ") || res.statusText;
      throw Object.assign(new PlatformError(`Reddit rejected the post in r/${creds.subreddit}: ${reason}`), { credentials: refreshed });
    }
    return { url: json?.json?.data?.url ?? null, credentials: refreshed };
  },
};
