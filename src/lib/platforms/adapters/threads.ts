import "server-only";
import { partialThreadNote, PlatformError, readError, requireEnv, type MediaFile, type OAuthAdapter } from "./shared";

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
    url.searchParams.set("scope", "threads_basic,threads_content_publish,threads_manage_insights");
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

  async publish(c, text, media, thread = []) {
    const refreshed = await refreshIfDue(c);
    const creds = refreshed ?? c;
    const api = (path: string, params: Record<string, string>) =>
      fetch(`${GRAPH}/v1.0/${path}`, {
        method: "POST",
        body: new URLSearchParams({ ...params, access_token: creds.accessToken }),
        cache: "no-store",
      });

    let postId: string;
    try {
      if (media.length === 0) {
        // auto_publish_text skips the separate threads_publish call for text-only posts.
        postId = (await getJson<{ id: string }>(await api(`${creds.userId}/threads`, { media_type: "TEXT", text, auto_publish_text: "true" }), "post")).id;
      } else {
        let containerId: string;
        if (media.length === 1) {
          containerId = await createItem(api, creds.userId, media[0], { text });
        } else {
          const children = [];
          for (const file of media) children.push(await createItem(api, creds.userId, file, { is_carousel_item: "true" }));
          await Promise.all(children.map((id) => waitUntilReady(id, creds.accessToken)));
          containerId = (await getJson<{ id: string }>(
            await api(`${creds.userId}/threads`, { media_type: "CAROUSEL", children: children.join(","), text }),
            "carousel",
          )).id;
        }
        await waitUntilReady(containerId, creds.accessToken);
        postId = (await getJson<{ id: string }>(await api(`${creds.userId}/threads_publish`, { creation_id: containerId }), "publish")).id;
      }
    } catch (err) {
      // Keep a refreshed token even when the post fails.
      throw Object.assign(err as Error, { credentials: refreshed ?? undefined });
    }

    let url: string | null = null;
    try {
      const linkUrl = new URL(`${GRAPH}/v1.0/${postId}`);
      linkUrl.searchParams.set("fields", "permalink");
      linkUrl.searchParams.set("access_token", creds.accessToken);
      const res = await fetch(linkUrl, { cache: "no-store" });
      if (res.ok) url = ((await res.json()) as { permalink?: string }).permalink ?? null;
    } catch {
      // The post is live either way; a missing link isn't worth failing over.
    }
    // Thread: each further part is a text reply to the previous post.
    let previous = postId;
    for (const [i, part] of thread.entries()) {
      try {
        previous = (await getJson<{ id: string }>(
          await api(`${creds.userId}/threads`, { media_type: "TEXT", text: part, reply_to_id: previous, auto_publish_text: "true" }),
          `part ${i + 2}`,
        )).id;
      } catch (err) {
        return { url, remoteId: postId, credentials: refreshed ?? undefined, note: partialThreadNote(i + 1, thread.length + 1, err) };
      }
    }
    return { url, remoteId: postId, credentials: refreshed ?? undefined };
  },

  async metrics(c, id) {
    const refreshed = (await refreshIfDue(c)) ?? undefined;
    const creds = refreshed ?? c;
    const url = new URL(`${GRAPH}/v1.0/${id}/insights`);
    url.searchParams.set("metric", "views,likes,replies,reposts,quotes");
    url.searchParams.set("access_token", creds.accessToken);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      // Accounts connected before insights were requested need reconnecting for numbers.
      throw Object.assign(new PlatformError(`Threads stats lookup failed: ${await readError(res)}`), { credentials: refreshed });
    }
    const { data } = (await res.json()) as { data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };
    const get = (name: string) => {
      const row = data.find((d) => d.name === name);
      return row?.total_value?.value ?? row?.values?.[0]?.value ?? 0;
    };
    return { metrics: { views: get("views"), likes: get("likes"), comments: get("replies"), shares: get("reposts") + get("quotes") }, credentials: refreshed };
  },
};

type Api = (path: string, params: Record<string, string>) => Promise<Response>;

/** One image or video container. Threads fetches the file itself from the signed URL. */
async function createItem(api: Api, userId: string, file: MediaFile, extra: Record<string, string>) {
  const isVideo = file.mime.startsWith("video/");
  const params: Record<string, string> = {
    media_type: isVideo ? "VIDEO" : "IMAGE",
    [isVideo ? "video_url" : "image_url"]: file.url,
    ...extra,
  };
  if (file.alt) params.alt_text = file.alt.slice(0, 1000);
  return (await getJson<{ id: string }>(await api(`${userId}/threads`, params), isVideo ? "video upload" : "image upload")).id;
}

/**
 * Threads processes media asynchronously; publishing before it's FINISHED fails.
 * Images take a few seconds; videos can take longer than one publisher run allows.
 */
async function waitUntilReady(containerId: string, accessToken: string, budgetMs = 45_000) {
  const deadline = Date.now() + budgetMs;
  for (let delay = 1500; ; delay = Math.min(delay * 1.5, 5000)) {
    const url = new URL(`${GRAPH}/v1.0/${containerId}`);
    url.searchParams.set("fields", "status,error_message");
    url.searchParams.set("access_token", accessToken);
    const { status, error_message } = await getJson<{ status: string; error_message?: string }>(
      await fetch(url, { cache: "no-store" }),
      "processing check",
    );
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new PlatformError(`Threads couldn't process the media: ${error_message ?? status.toLowerCase()}`);
    }
    if (Date.now() + delay > deadline) throw new PlatformError("Threads is still processing the media. Try a shorter video or post again in a minute.");
    await new Promise((r) => setTimeout(r, delay));
  }
}
