import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { saveAccount } from "@/lib/accounts";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { describeError, getOAuthAdapter } from "@/lib/platforms/adapters";
import { OAUTH_COOKIE, redirectUri, type OAuthPending } from "@/lib/oauth";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The platform sends the user back here after they approve (or cancel) the connection. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const q = request.nextUrl.searchParams;

  let pending: OAuthPending | null = null;
  try {
    const raw = request.cookies.get(OAUTH_COOKIE)?.value;
    pending = raw ? decryptJson<OAuthPending>(raw) : null;
  } catch {
    pending = null;
  }

  const finish = (path: string, params: Record<string, string>) => {
    const res = NextResponse.redirect(new URL(`${path}?${new URLSearchParams(params)}`, request.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/oauth", maxAge: 0 });
    return res;
  };

  if (!pending || pending.platform !== platform || pending.exp < Date.now() || !sameString(pending.state, q.get("state") ?? "")) {
    return finish("/", { error: "That sign-in link expired or didn't match. Start connecting the account again." });
  }

  const ws = await getWorkspace(pending.slug);
  const accountsPath = `/w/${ws.slug}/accounts`;
  if (q.get("error")) {
    return finish(accountsPath, { error: q.get("error_description") || "The connection was cancelled." });
  }

  const adapter = getOAuthAdapter(platform);
  const code = (q.get("code") ?? "").replace(/#_$/, ""); // Meta sometimes appends "#_"
  if (!adapter || !code) return finish(accountsPath, { error: "The platform didn't send back a sign-in code." });

  try {
    const result = await adapter.exchange({ code, redirectUri: redirectUri(request, platform), codeVerifier: pending.verifier });
    const supabase = await createClient();
    if ("choose" in result) {
      // Several accounts came back; let the user pick the one that belongs to this project.
      const { data: row, error } = await supabase
        .from("pending_connections")
        .insert({ workspace_id: ws.id, platform, choices: encryptJson(result.choose) })
        .select("id")
        .single();
      if (error || !row) return finish(accountsPath, { error: error?.message ?? "Couldn't save the accounts to choose from." });
      return finish(`${accountsPath}/pick`, { id: row.id });
    }
    const saved = await saveAccount(supabase, ws.id, platform, result);
    if (saved.error) return finish(accountsPath, { error: saved.error });
    return finish(accountsPath, { [saved.reconnected ? "reconnected" : "connected"]: saved.label });
  } catch (err) {
    return finish(accountsPath, { error: describeError(err) });
  }
}
