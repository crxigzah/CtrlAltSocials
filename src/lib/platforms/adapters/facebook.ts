import "server-only";
import { PlatformError, readError, requireEnv, type ConnectResult, type MediaFile, type OAuthAdapter } from "./shared";

// Facebook Pages via Facebook Login. The user signs in once; every Page they manage
// comes back with its own Page token, and they pick which Page belongs to the project.
// Page tokens derived from a long-lived user token don't expire.

type FacebookCredentials = { pageId: string; pageToken: string; name: string };

const GRAPH = "https://graph.facebook.com/v21.0";

async function getJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new PlatformError(`Facebook ${what} failed: ${await readError(res)}`);
  return (await res.json()) as T;
}

export const facebook: OAuthAdapter<FacebookCredentials> = {
  kind: "oauth",
  env: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "pages_show_list,pages_manage_posts,pages_read_engagement");
    return url.toString();
  },

  async exchange({ code, redirectUri }) {
    const appId = requireEnv("FACEBOOK_APP_ID");
    const secret = requireEnv("FACEBOOK_APP_SECRET");

    const shortUrl = new URL(`${GRAPH}/oauth/access_token`);
    shortUrl.search = new URLSearchParams({ client_id: appId, client_secret: secret, redirect_uri: redirectUri, code }).toString();
    const short = await getJson<{ access_token: string }>(await fetch(shortUrl, { cache: "no-store" }), "sign-in");

    const longUrl = new URL(`${GRAPH}/oauth/access_token`);
    longUrl.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: short.access_token }).toString();
    const long = await getJson<{ access_token: string }>(await fetch(longUrl, { cache: "no-store" }), "token exchange");

    const pagesUrl = new URL(`${GRAPH}/me/accounts`);
    pagesUrl.search = new URLSearchParams({ fields: "id,name,access_token,tasks", limit: "100", access_token: long.access_token }).toString();
    const { data: pages } = await getJson<{ data: { id: string; name: string; access_token: string; tasks?: string[] }[] }>(
      await fetch(pagesUrl, { cache: "no-store" }),
      "Page lookup",
    );
    const usable = pages.filter((p) => !p.tasks || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE"));
    if (usable.length === 0) {
      throw new PlatformError("No Pages came back. Create the project's Facebook Page first, and tick it when Facebook asks which Pages to share.");
    }
    const choices: ConnectResult<FacebookCredentials>[] = usable.map((p) => ({
      credentials: { pageId: p.id, pageToken: p.access_token, name: p.name },
      label: p.name,
      remoteId: p.id,
    }));
    return choices.length === 1 ? choices[0] : { choose: choices };
  },

  async publish(c, text, media) {
    const post = (path: string, params: Record<string, string>) =>
      fetch(`${GRAPH}/${path}`, { method: "POST", body: new URLSearchParams({ ...params, access_token: c.pageToken }), cache: "no-store" });

    const video = media.find((m) => m.mime.startsWith("video/"));
    if (video) {
      const { id } = await getJson<{ id: string }>(await post(`${c.pageId}/videos`, { file_url: video.url, description: text }), "video upload");
      return { url: `https://www.facebook.com/${c.pageId}/videos/${id}`, remoteId: `video:${id}` };
    }

    const params: Record<string, string> = { message: text };
    for (const [i, image] of media.entries()) params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: await uploadPhoto(post, c.pageId, image) });
    const { id } = await getJson<{ id: string }>(await post(`${c.pageId}/feed`, params), "post");
    return { url: `https://www.facebook.com/${id}`, remoteId: id };
  },

  async metrics(c, remoteId) {
    const isVideo = remoteId.startsWith("video:");
    const id = isVideo ? remoteId.slice(6) : remoteId;
    const url = new URL(`${GRAPH}/${id}`);
    url.searchParams.set(
      "fields",
      isVideo ? "likes.summary(true).limit(0),comments.summary(true).limit(0)" : "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
    );
    url.searchParams.set("access_token", c.pageToken);
    const m = await getJson<{
      reactions?: { summary?: { total_count?: number } };
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    }>(await fetch(url, { cache: "no-store" }), "stats lookup");
    return {
      metrics: {
        likes: (m.reactions ?? m.likes)?.summary?.total_count ?? 0,
        comments: m.comments?.summary?.total_count ?? 0,
        shares: m.shares?.count ?? 0,
      },
    };
  },
};

/** Photos are uploaded unpublished, then attached to a single feed post together. */
async function uploadPhoto(post: (path: string, params: Record<string, string>) => Promise<Response>, pageId: string, image: MediaFile) {
  const params: Record<string, string> = { url: image.url, published: "false" };
  if (image.alt) params.alt_text_custom = image.alt.slice(0, 1000);
  const { id } = await getJson<{ id: string }>(await post(`${pageId}/photos`, params), "photo upload");
  return id;
}
