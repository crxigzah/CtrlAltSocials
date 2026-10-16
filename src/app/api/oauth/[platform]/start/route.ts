import { NextResponse, type NextRequest } from "next/server";
import { encryptJson } from "@/lib/crypto";
import { getOAuthAdapter, missingEnv } from "@/lib/platforms/adapters";
import { newPending, OAUTH_COOKIE, OAUTH_MAX_AGE, redirectUri } from "@/lib/oauth";
import { requireOwner } from "@/lib/workspace";

/** Sends the user to the platform's sign-in page to connect an account to a project. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const slug = request.nextUrl.searchParams.get("workspace") ?? "";
  const ws = await requireOwner(slug); // only the owner connects accounts
  const back = new URL(`/w/${ws.slug}/accounts`, request.url);

  const adapter = getOAuthAdapter(platform);
  const missing = missingEnv(platform);
  if (!adapter || missing.length) {
    back.searchParams.set("error", adapter ? `Set ${missing.join(" and ")} on the server first.` : "That platform can't be connected yet.");
    return NextResponse.redirect(back);
  }

  const pending = newPending(ws.slug, platform);
  const { challenge, ...cookie } = pending;
  const response = NextResponse.redirect(
    adapter.authorizeUrl({ state: pending.state, redirectUri: redirectUri(request, platform), codeChallenge: challenge }),
  );
  response.cookies.set(OAUTH_COOKIE, encryptJson(cookie), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/oauth",
    maxAge: OAUTH_MAX_AGE,
  });
  return response;
}
