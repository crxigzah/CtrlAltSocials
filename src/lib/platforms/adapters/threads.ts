import "server-only";
import { PlatformError, readError, requireEnv, type OAuthAdapter } from "./shared";

// Threads (Meta). Sign in with the project's Instagram-linked Threads account.
// Long-lived tokens last 60 days and are refreshed automatically when a post goes
// out within a week of expiry, so an account posted to at least monthly never lapses.

type ThreadsCredentials = { accessToken: string; expiresAt: number; userId: string; username: string };

const GRAPH = "https://graph.threads.net";
const DAY = 24 * 60 * 60 * 1000;

async function getJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new PlatformError(`Threads ${what} failed: ${await readError(res)}`);
  return (await res.json()) as T;
}

async function refreshIfDue(c: ThreadsCredentials): Promise<ThreadsCredentials | null> {
  if (Date.now() > c.expiresAt) throw new PlatformError("The Threads sign-in expired. Reconnect the account on the Accounts tab.");
  if (c.expiresAt - Date.now() > 7 * DAY) return null;
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", c.accessToken);
  const token = await getJson<{ access_token: string; expires_in: number }>(await fetch(url, { cache: "no-store" }), "token refresh");
  return { ...c, accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
}

export const threads: OAuthAdapter<ThreadsCredentials> = {
  kind: "oauth",
  env: ["THREADS_APP_ID", "THREADS_APP_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", requireEnv("THREADS_APP_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "threads_basic,threads_content_publish");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchange({ code, redirectUri }) {
    const short = await getJson<{ access_token: string; user_id: number | string }>(
      await fetch(`${GRAPH}/oauth/access_token`, {
        method: "POST",
        body: new URLSearchParams({
          client_id: requireEnv("THREADS_APP_ID"),
          client_secret: requireEnv("THREADS_APP_SECRET"),
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }),
        cache: "no-store",
      }),
      "sign-in",
    );

    const longUrl = new URL(`${GRAPH}/access_token`);
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", requireEnv("THREADS_APP_SECRET"));
    longUrl.searchParams.set("access_token", short.access_token);
    const long = await getJson<{ access_token: string; expires_in: number }>(await fetch(longUrl, { cache: "no-store" }), "token exchange");

    const meUrl = new URL(`${GRAPH}/v1.0/me`);
    meUrl.searchParams.set("fields", "id,username");
    meUrl.searchParams.set("access_token", long.access_token);
    const me = await getJson<{ id: string; username: string }>(await fetch(meUrl, { cache: "no-store" }), "profile lookup");

    return {
      credentials: { accessToken: long.access_token, expiresAt: Date.now() + long.expires_in * 1000, userId: me.id, username: me.username },
      label: `@${me.username}`,
      remoteId: me.id,
    };
  },

  async publish(c, text) {
    const refreshed = await refreshIfDue(c);
    const creds = refreshed ?? c;

    // auto_publish_text skips the separate threads_publish call (and Meta's suggested 30s wait) for text-only posts.
    const created = await getJson<{ id: string }>(
      await fetch(`${GRAPH}/v1.0/${creds.userId}/threads`, {
        method: "POST",
        body: new URLSearchParams({ media_type: "TEXT", text, auto_publish_text: "true", access_token: creds.accessToken }),
        cache: "no-store",
      }),
      "post",
    );

    let url: string | null = null;
    try {
      const linkUrl = new URL(`${GRAPH}/v1.0/${created.id}`);
      linkUrl.searchParams.set("fields", "permalink");
      linkUrl.searchParams.set("access_token", creds.accessToken);
      const res = await fetch(linkUrl, { cache: "no-store" });
      if (res.ok) url = ((await res.json()) as { permalink?: string }).permalink ?? null;
    } catch {
      // The post is live either way; a missing link isn't worth failing over.
    }
    return { url, credentials: refreshed ?? undefined };
  },
};
