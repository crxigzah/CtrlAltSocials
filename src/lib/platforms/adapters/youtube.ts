import "server-only";
import { PlatformError, readError, requireEnv, type OAuthAdapter } from "./shared";

// YouTube via Google sign-in. Uploads one video per post; the first line of the
// text becomes the title and the whole text the description. Google keeps uploads
// from unaudited API projects private, which the adapter reports back.

type YouTubeCredentials = { accessToken: string; refreshToken: string; expiresAt: number; channelId: string; channelTitle: string };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

async function token(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), ...params }),
    cache: "no-store",
  });
  if (!res.ok) {
    const reason = await readError(res);
    throw new PlatformError(
      params.grant_type === "refresh_token" ? `YouTube sign-in expired (${reason}). Reconnect the channel.` : `Google sign-in failed: ${reason}`,
    );
  }
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

/** "First line" title, trimmed to YouTube's 100 characters; angle brackets aren't allowed in titles. */
export function youtubeTitle(text: string) {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  const clean = line.replace(/[<>]/g, "");
  return [...clean].length > 100 ? [...clean].slice(0, 99).join("") + "…" : clean;
}

export const youtube: OAuthAdapter<YouTubeCredentials> = {
  kind: "oauth",
  env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("access_type", "offline");
    // Without prompt=consent Google only returns a refresh token the first time.
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },

  async exchange({ code, redirectUri, codeVerifier }) {
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
    if (!t.refresh_token) throw new PlatformError("Google didn't return a refresh token. Remove the app's access in your Google account and connect again.");
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${t.access_token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new PlatformError(`YouTube channel lookup failed: ${await readError(res)}`);
    const { items } = (await res.json()) as { items?: { id: string; snippet: { title: string; customUrl?: string } }[] };
    const channel = items?.[0];
    if (!channel) throw new PlatformError("That Google account doesn't have a YouTube channel yet. Create one, then connect again.");
    return {
      credentials: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000,
        channelId: channel.id,
        channelTitle: channel.snippet.title,
      },
      label: channel.snippet.customUrl ?? channel.snippet.title,
      remoteId: channel.id,
    };
  },

  async publish(c, text, media) {
    const video = media.find((m) => m.mime.startsWith("video/"));
    if (!video) throw new PlatformError("YouTube posts need a video.");

    let creds = c;
    let refreshed: YouTubeCredentials | undefined;
    if (c.expiresAt - Date.now() < 5 * 60 * 1000) {
      const t = await token({ grant_type: "refresh_token", refresh_token: c.refreshToken });
      refreshed = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token ?? c.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
      creds = refreshed;
    }
    const keepToken = (err: PlatformError) => Object.assign(err, { credentials: refreshed });

    const bytes = await video.bytes();
    const session = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": video.mime,
        "X-Upload-Content-Length": String(bytes.length),
      },
      body: JSON.stringify({
        snippet: { title: youtubeTitle(text) || "Untitled", description: text.slice(0, 5000), categoryId: "20" },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
      cache: "no-store",
    });
    const uploadUrl = session.headers.get("location");
    if (!session.ok || !uploadUrl) throw keepToken(new PlatformError(`YouTube refused the upload: ${await readError(session)}`));

    // Files are capped at 50 MB, so one PUT carries the whole video.
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": video.mime, "Content-Length": String(bytes.length) },
      body: new Uint8Array(bytes),
      cache: "no-store",
    });
    if (!put.ok) throw keepToken(new PlatformError(`YouTube upload failed: ${await readError(put)}`));
    const uploaded = (await put.json()) as { id: string; status?: { privacyStatus?: string } };
    const note =
      uploaded.status?.privacyStatus && uploaded.status.privacyStatus !== "public"
        ? "Uploaded as private: Google keeps uploads from unaudited API projects private until the project passes its audit."
        : undefined;
    return { url: `https://www.youtube.com/watch?v=${uploaded.id}`, remoteId: uploaded.id, credentials: refreshed, note };
  },

  async metrics(c, id) {
    let refreshed: YouTubeCredentials | undefined;
    if (c.expiresAt - Date.now() < 5 * 60 * 1000) {
      const t = await token({ grant_type: "refresh_token", refresh_token: c.refreshToken });
      refreshed = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token ?? c.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
    }
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${(refreshed ?? c).accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) throw Object.assign(new PlatformError(`YouTube stats lookup failed: ${await readError(res)}`), { credentials: refreshed });
    const stats = ((await res.json()) as { items?: { statistics: Record<string, string> }[] }).items?.[0]?.statistics;
    if (!stats) throw Object.assign(new PlatformError("That YouTube video no longer exists."), { credentials: refreshed });
    const n = (k: string) => (stats[k] === undefined ? undefined : Number(stats[k]));
    return { metrics: { views: n("viewCount"), likes: n("likeCount"), comments: n("commentCount") }, credentials: refreshed };
  },
};
