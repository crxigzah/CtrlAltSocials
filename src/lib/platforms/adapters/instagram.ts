import "server-only";
import { PlatformError, readError, requireEnv, type MediaFile, type OAuthAdapter } from "./shared";

// Instagram API with Instagram Login: posts to a Professional (Business or Creator)
// account without needing a Facebook Page. Instagram fetches media from the signed
// URLs itself. Long-lived tokens last 60 days and are refreshed within a week of expiry.

type InstagramCredentials = { accessToken: string; expiresAt: number; userId: string; username: string };

const GRAPH = "https://graph.instagram.com";
const VERSION = "v21.0";
const DAY = 24 * 60 * 60 * 1000;

async function getJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new PlatformError(`Instagram ${what} failed: ${await readError(res)}`);
  return (await res.json()) as T;
}

async function refreshIfDue(c: InstagramCredentials): Promise<InstagramCredentials | null> {
  if (Date.now() > c.expiresAt) throw new PlatformError("The Instagram sign-in expired. Reconnect the account on the Accounts tab.");
  if (c.expiresAt - Date.now() > 7 * DAY) return null;
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", c.accessToken);
  const token = await getJson<{ access_token: string; expires_in: number }>(await fetch(url, { cache: "no-store" }), "token refresh");
  return { ...c, accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
}

export const instagram: OAuthAdapter<InstagramCredentials> = {
  kind: "oauth",
  env: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", requireEnv("INSTAGRAM_APP_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchange({ code, redirectUri }) {
    const short = await getJson<{ access_token: string; user_id: number | string }>(
      await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: requireEnv("INSTAGRAM_APP_ID"),
          client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }),
        cache: "no-store",
      }),
      "sign-in",
    );

    const longUrl = new URL(`${GRAPH}/access_token`);
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
    longUrl.searchParams.set("access_token", short.access_token);
    const long = await getJson<{ access_token: string; expires_in: number }>(await fetch(longUrl, { cache: "no-store" }), "token exchange");

    const meUrl = new URL(`${GRAPH}/${VERSION}/me`);
    meUrl.searchParams.set("fields", "user_id,username,account_type");
    meUrl.searchParams.set("access_token", long.access_token);
    const me = await getJson<{ user_id: string; username: string; account_type?: string }>(await fetch(meUrl, { cache: "no-store" }), "profile lookup");
    if (me.account_type && !["BUSINESS", "MEDIA_CREATOR"].includes(me.account_type)) {
      throw new PlatformError(`@${me.username} is a personal account. Switch it to a Professional (Business or Creator) account in Instagram's settings, then connect again.`);
    }

    return {
      credentials: { accessToken: long.access_token, expiresAt: Date.now() + long.expires_in * 1000, userId: String(me.user_id), username: me.username },
      label: `@${me.username}`,
      remoteId: String(me.user_id),
    };
  },

  async publish(c, text, media) {
    if (media.length === 0) throw new PlatformError("Instagram posts need an image or video.");
    const refreshed = await refreshIfDue(c);
    const creds = refreshed ?? c;
    const api: Api = (path, params) =>
      fetch(`${GRAPH}/${VERSION}/${path}`, {
        method: "POST",
        body: new URLSearchParams({ ...params, access_token: creds.accessToken }),
        cache: "no-store",
      });

    let mediaId: string;
    try {
      let containerId: string;
      if (media.length === 1) {
        containerId = await createItem(api, creds.userId, media[0], { caption: text }, false);
      } else {
        const children = [];
        for (const file of media) children.push(await createItem(api, creds.userId, file, { is_carousel_item: "true" }, true));
        await Promise.all(children.map((id) => waitUntilReady(id, creds.accessToken)));
        containerId = (await getJson<{ id: string }>(
          await api(`${creds.userId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: text }),
          "carousel",
        )).id;
      }
      await waitUntilReady(containerId, creds.accessToken);
      mediaId = (await getJson<{ id: string }>(await api(`${creds.userId}/media_publish`, { creation_id: containerId }), "publish")).id;
    } catch (err) {
      throw Object.assign(err as Error, { credentials: refreshed ?? undefined });
    }

    let url: string | null = null;
    try {
      const linkUrl = new URL(`${GRAPH}/${VERSION}/${mediaId}`);
      linkUrl.searchParams.set("fields", "permalink");
      linkUrl.searchParams.set("access_token", creds.accessToken);
      const res = await fetch(linkUrl, { cache: "no-store" });
      if (res.ok) url = ((await res.json()) as { permalink?: string }).permalink ?? null;
    } catch {
      // Live either way.
    }
    return { url, credentials: refreshed ?? undefined };
  },
};

type Api = (path: string, params: Record<string, string>) => Promise<Response>;

/** A single video posts as a Reel; inside a carousel it's a plain VIDEO item. */
async function createItem(api: Api, userId: string, file: MediaFile, extra: Record<string, string>, inCarousel: boolean) {
  const isVideo = file.mime.startsWith("video/");
  const params: Record<string, string> = isVideo
    ? { media_type: inCarousel ? "VIDEO" : "REELS", video_url: file.url, ...extra }
    : { image_url: file.url, ...extra };
  return (await getJson<{ id: string }>(await api(`${userId}/media`, params), isVideo ? "video upload" : "image upload")).id;
}

async function waitUntilReady(containerId: string, accessToken: string, budgetMs = 45_000) {
  const deadline = Date.now() + budgetMs;
  for (let delay = 1500; ; delay = Math.min(delay * 1.5, 5000)) {
    const url = new URL(`${GRAPH}/${VERSION}/${containerId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", accessToken);
    const { status_code, status } = await getJson<{ status_code: string; status?: string }>(await fetch(url, { cache: "no-store" }), "processing check");
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new PlatformError(`Instagram couldn't process the media: ${status ?? status_code.toLowerCase()}`);
    }
    if (Date.now() + delay > deadline) throw new PlatformError("Instagram is still processing the video. Try a shorter one or post again in a minute.");
    await new Promise((r) => setTimeout(r, delay));
  }
}
