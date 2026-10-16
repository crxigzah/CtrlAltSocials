import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

// The OAuth round trip carries its state in a short-lived, encrypted, httpOnly cookie:
// the random `state` echoed back by the platform, the PKCE verifier, and which
// project the account is being connected to.

export const OAUTH_COOKIE = "cas_oauth";
export const OAUTH_MAX_AGE = 10 * 60;

export type OAuthPending = { state: string; verifier: string; slug: string; platform: string; exp: number };

export function newPending(slug: string, platform: string): OAuthPending & { challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(24).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    slug,
    platform,
    exp: Date.now() + OAUTH_MAX_AGE * 1000,
  };
}

/** Must match the redirect URI registered with each platform exactly. */
export function redirectUri(request: NextRequest, platform: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "") || request.nextUrl.origin;
  return `${base}/api/oauth/${platform}/callback`;
}
