import "server-only";
import { PlatformError, readError, requireEnv, type OAuthAdapter } from "./shared";

// X (Twitter) API v2 with OAuth 2.0 + PKCE. Access tokens last two hours; the refresh
// token (from offline.access) is single-use and rotates on every refresh, so the new
// one must always be saved.

type XCredentials = { accessToken: string; refreshToken: string; expiresAt: number; userId: string; username: string };

const API = "https://api.x.com/2";
const SCOPES = "tweet.read tweet.write users.read offline.access";

function basicAuth() {
  return "Basic " + Buffer.from(`${requireEnv("X_CLIENT_ID")}:${requireEnv("X_CLIENT_SECRET")}`).toString("base64");
}

async function token(params: Record<string, string>) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  if (!res.ok) {
    const reason = await readError(res);
    throw new PlatformError(
      params.grant_type === "refresh_token"
        ? `X sign-in expired (${reason}). Reconnect the account on the Accounts tab.`
        : `X sign-in failed: ${reason}`,
    );
  }
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!json.refresh_token) throw new PlatformError("X didn't return a refresh token. Check the app has offline.access enabled.");
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

export const x: OAuthAdapter<XCredentials> = {
  kind: "oauth",
  env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const url = new URL("https://x.com/i/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", requireEnv("X_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },

  async exchange({ code, redirectUri, codeVerifier }) {
    const tokens = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
    const res = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}` }, cache: "no-store" });
    if (!res.ok) throw new PlatformError(`X profile lookup failed: ${await readError(res)}`);
    const { data } = (await res.json()) as { data: { id: string; username: string } };
    return {
      credentials: { ...tokens, userId: data.id, username: data.username },
      label: `@${data.username}`,
      remoteId: data.id,
    };
  },

  async publish(c, text) {
    const refreshed =
      c.expiresAt - Date.now() < 5 * 60 * 1000
        ? { ...c, ...(await token({ grant_type: "refresh_token", refresh_token: c.refreshToken })) }
        : null;
    const creds = refreshed ?? c;

    const res = await fetch(`${API}/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    if (!res.ok) {
      const reason = await readError(res);
      // Even when the post fails, a rotated refresh token has to be kept or the account is locked out.
      throw Object.assign(new PlatformError(`X rejected the post: ${reason}`), { credentials: refreshed ?? undefined });
    }
    const { data } = (await res.json()) as { data: { id: string } };
    return { url: `https://x.com/${creds.username}/status/${data.id}`, credentials: refreshed ?? undefined };
  },
};
