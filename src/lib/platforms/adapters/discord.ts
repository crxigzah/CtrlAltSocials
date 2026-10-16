import "server-only";
import { PlatformError, readError, type FormAdapter } from "./shared";

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

export const discord: FormAdapter<DiscordCredentials> = {
  kind: "form",
  async connect(input) {
    const webhookUrl = parseWebhook(String(input.get("webhook_url") ?? ""));
    const res = await fetch(webhookUrl, { cache: "no-store" });
    if (!res.ok) throw new PlatformError(`Discord didn't recognise that webhook: ${await readError(res)}`);
    const hook = (await res.json()) as { id: string; name?: string; guild_id?: string };
    return {
      credentials: { webhookUrl, guildId: hook.guild_id },
      label: hook.name ? `${hook.name} (webhook)` : "Discord webhook",
      remoteId: hook.id,
    };
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
