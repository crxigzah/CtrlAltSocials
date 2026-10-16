import "server-only";
import { PlatformError, readError, requireEnv, type OAuthAdapter } from "./shared";

// TikTok Content Posting API (direct post, file upload). Until TikTok audits the app,
// it only accepts private (SELF_ONLY) posts; the adapter falls back to that and says so.

type TikTokCredentials = { accessToken: string; refreshToken: string; expiresAt: number; openId: string; username: string };

const API = "https://open.tiktokapis.com/v2";

type TikTokResponse<T> = { data: T; error: { code: string; message: string } };

async function call<T>(res: Response, what: string): Promise<T> {
  const json = (await res.json().catch(() => null)) as TikTokResponse<T> | null;
  if (!res.ok || !json || (json.error && json.error.code !== "ok")) {
    const err = new PlatformError(`TikTok ${what} failed: ${json?.error?.message || json?.error?.code || res.statusText}`);
    throw Object.assign(err, { code: json?.error?.code });
  }
  return json.data;
}

async function token(params: Record<string, string>) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: requireEnv("TIKTOK_CLIENT_KEY"), client_secret: requireEnv("TIKTOK_CLIENT_SECRET"), ...params }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const reason = json.error_description ?? (await readError(res));
    throw new PlatformError(params.grant_type === "refresh_token" ? `TikTok sign-in expired (${reason}). Reconnect the account.` : `TikTok sign-in failed: ${reason}`);
  }
  return json as { access_token: string; refresh_token: string; expires_in: number; open_id: string };
}

const authed = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" });

async function creatorInfo(accessToken: string) {
  return call<{ creator_username: string; privacy_level_options: string[]; max_video_post_duration_sec?: number }>(
    await fetch(`${API}/post/publish/creator_info/query/`, { method: "POST", headers: authed(accessToken), cache: "no-store" }),
    "account check",
  );
}

export const tiktok: OAuthAdapter<TikTokCredentials> = {
  kind: "oauth",
  env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", requireEnv("TIKTOK_CLIENT_KEY"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user.info.basic,video.publish");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchange({ code, redirectUri }) {
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const info = await creatorInfo(t.access_token);
    return {
      credentials: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000, openId: t.open_id, username: info.creator_username },
      label: `@${info.creator_username}`,
      remoteId: t.open_id,
    };
  },

  async publish(c, text, media) {
    const video = media.find((m) => m.mime.startsWith("video/"));
    if (!video) throw new PlatformError("TikTok posts need a video.");

    let creds = c;
    let refreshed: TikTokCredentials | undefined;
    if (c.expiresAt - Date.now() < 5 * 60 * 1000) {
      const t = await token({ grant_type: "refresh_token", refresh_token: c.refreshToken });
      refreshed = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token ?? c.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 };
      creds = refreshed;
    }

    try {
      const info = await creatorInfo(creds.accessToken);
      const bytes = await video.bytes();
      const init = (privacy: string) =>
        fetch(`${API}/post/publish/video/init/`, {
          method: "POST",
          headers: authed(creds.accessToken),
          body: JSON.stringify({
            post_info: { title: text.slice(0, 2200), privacy_level: privacy },
            // Files are capped at 50 MB, inside TikTok's single-chunk limit.
            source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
          }),
          cache: "no-store",
        });

      const wanted = info.privacy_level_options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : info.privacy_level_options[0];
      let note: string | undefined;
      let started: { publish_id: string; upload_url: string };
      try {
        started = await call(await init(wanted), "upload");
      } catch (err) {
        if ((err as { code?: string }).code !== "unaudited_client_can_only_post_to_private_accounts") throw err;
        started = await call(await init("SELF_ONLY"), "upload");
        note = "Posted as private: TikTok only allows private posts until the app passes its review.";
      }

      const put = await fetch(started.upload_url, {
        method: "PUT",
        headers: { "Content-Type": video.mime, "Content-Length": String(bytes.length), "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
        body: new Uint8Array(bytes),
        cache: "no-store",
      });
      if (!put.ok) throw new PlatformError(`TikTok upload failed: ${await readError(put)}`);

      // TikTok processes the video afterwards; wait briefly for the post id so we can link it.
      let url: string | null = null;
      for (let i = 0; i < 8 && !url; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await call<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
          await fetch(`${API}/post/publish/status/fetch/`, { method: "POST", headers: authed(creds.accessToken), body: JSON.stringify({ publish_id: started.publish_id }), cache: "no-store" }),
          "status check",
        );
        if (status.status === "FAILED") throw new PlatformError(`TikTok couldn't publish the video: ${status.fail_reason ?? "unknown reason"}`);
        const id = status.publicaly_available_post_id?.[0];
        if (status.status === "PUBLISH_COMPLETE") url = id ? `https://www.tiktok.com/@${creds.username}/video/${id}` : `https://www.tiktok.com/@${creds.username}`;
      }
      return { url, credentials: refreshed, note };
    } catch (err) {
      throw Object.assign(err as Error, { credentials: refreshed });
    }
  },
};
