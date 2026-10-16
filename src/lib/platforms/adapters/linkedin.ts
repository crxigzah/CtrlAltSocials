import "server-only";
import { PlatformError, readError, requireEnv, type MediaFile, type OAuthAdapter } from "./shared";

// LinkedIn personal profile posts via "Sign In with LinkedIn (OpenID Connect)" and
// "Share on LinkedIn" (w_member_social). Tokens last 60 days and self-serve apps get
// no refresh token, so the account needs reconnecting every couple of months.

type LinkedInCredentials = { accessToken: string; expiresAt: number; personUrn: string; name: string };

/**
 * LinkedIn requires a YYYYMM API version and retires each after about a year. Unless
 * LINKEDIN_VERSION pins one, use the month two months back: released and well supported.
 */
function apiVersion() {
  if (process.env.LINKEDIN_VERSION) return process.env.LINKEDIN_VERSION;
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 2);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * LinkedIn's "little text" format treats several characters as markup; unescaped they
 * truncate or reject the post. Escape them, but keep #hashtags as real hashtags.
 */
export function linkedInCommentary(text: string): string {
  const escape = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (ch) => `\\${ch}`);
  // Links are left exactly as written so LinkedIn still recognises them.
  const parts = text.split(/(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/u);
  return parts
    .map((p) => (/^https?:\/\//.test(p) ? p : /^#[\p{L}\p{N}_]+$/u.test(p) ? `{hashtag|\\#|${p.slice(1)}}` : escape(p)))
    .join("");
}

const rest = (c: LinkedInCredentials, path: string, init: RequestInit = {}) =>
  fetch(`https://api.linkedin.com/rest/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${c.accessToken}`,
      "LinkedIn-Version": apiVersion(),
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

async function uploadImage(c: LinkedInCredentials, file: MediaFile): Promise<string> {
  const init = await rest(c, "images?action=initializeUpload", {
    method: "POST",
    body: JSON.stringify({ initializeUploadRequest: { owner: c.personUrn } }),
  });
  if (!init.ok) throw new PlatformError(`LinkedIn refused the image upload: ${await readError(init)}`);
  const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } };
  const put = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": file.mime },
    body: new Uint8Array(await file.bytes()),
    cache: "no-store",
  });
  if (!put.ok) throw new PlatformError(`LinkedIn image upload failed: ${await readError(put)}`);
  return value.image;
}

export const linkedin: OAuthAdapter<LinkedInCredentials> = {
  kind: "oauth",
  env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", requireEnv("LINKEDIN_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "openid profile w_member_social");
    return url.toString();
  },

  async exchange({ code, redirectUri }) {
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: requireEnv("LINKEDIN_CLIENT_ID"),
        client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new PlatformError(`LinkedIn sign-in failed: ${await readError(res)}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    const me = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` }, cache: "no-store" });
    if (!me.ok) throw new PlatformError(`LinkedIn profile lookup failed: ${await readError(me)}`);
    const profile = (await me.json()) as { sub: string; name?: string };
    return {
      credentials: { accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000, personUrn: `urn:li:person:${profile.sub}`, name: profile.name ?? "LinkedIn" },
      label: profile.name ?? "LinkedIn profile",
      remoteId: profile.sub,
    };
  },

  async publish(c, text, media) {
    if (Date.now() > c.expiresAt) throw new PlatformError("The LinkedIn sign-in has expired (they last 60 days). Reconnect the account.");
    const images = [];
    for (const file of media) images.push(await uploadImage(c, file));
    const content =
      images.length === 1
        ? { media: { id: images[0] } }
        : images.length > 1
          ? { multiImage: { images: images.map((id) => ({ id })) } }
          : undefined;
    const res = await rest(c, "posts", {
      method: "POST",
      body: JSON.stringify({
        author: c.personUrn,
        commentary: linkedInCommentary(text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });
    if (!res.ok) throw new PlatformError(`LinkedIn rejected the post: ${await readError(res)}`);
    const urn = res.headers.get("x-restli-id");
    return { url: urn ? `https://www.linkedin.com/feed/update/${urn}` : null, remoteId: urn ?? undefined };
  },
};
