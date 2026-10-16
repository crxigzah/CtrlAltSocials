import { PlatformIcon } from "@/components/platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { missingEnv } from "@/lib/platforms/adapters";
import { getPlatform, LIVE_PLATFORMS, PLATFORMS } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/lib/types";
import { requireOwner } from "@/lib/workspace";
import { connectAccount, removeAccount, setSubreddit } from "../actions";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; connected?: string; reconnected?: string; saved?: string; platform?: string }>;
}) {
  const { slug } = await params;
  const { error, connected, reconnected, saved, platform: openPlatform } = await searchParams;
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("id, workspace_id, platform, label, status, last_error, created_at")
    .eq("workspace_id", ws.id)
    .order("created_at")
    .returns<Account[]>();
  const accounts = data ?? [];
  const connect = connectAccount.bind(null, slug);

  return (
    <div className="space-y-8">
      {error && <p className="notice-error">{error}</p>}
      {connected && <p className="notice-ok">Connected {connected}. Credentials are stored encrypted.</p>}
      {reconnected && <p className="notice-ok">Reconnected {reconnected} with fresh credentials.</p>}
      {saved && <p className="notice-ok">{saved}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold">Connected to {ws.name}</h2>
        {accounts.length === 0 && <p className="text-sm text-subtle">Nothing connected yet.</p>}
        {accounts.map((a) => (
          <div key={a.id} className="card flex items-center gap-3 p-4">
            <PlatformIcon platform={a.platform} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{a.label}</div>
              <div className="text-xs text-muted">
                {getPlatform(a.platform)?.name}
                {a.status === "error" && <span className="text-warn"> · Last post failed: {a.last_error}</span>}
              </div>
              {a.platform === "reddit" && (
                <form action={setSubreddit.bind(null, slug, a.id)} className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted">Posts to r/</span>
                  <input name="subreddit" required placeholder="geoguessr" className="input w-40 px-2 py-1 text-xs" />
                  <SubmitButton className="btn-ghost px-2 py-1 text-xs" pendingText="Saving…">Set</SubmitButton>
                </form>
              )}
            </div>
            {getPlatform(a.platform)?.connect === "oauth" && (
              <a href={`/api/oauth/${a.platform}/start?workspace=${slug}`} className="btn-ghost px-3 py-1 text-xs">Reconnect</a>
            )}
            <form action={removeAccount.bind(null, slug, a.id)}>
              <button className="btn-danger px-3 py-1 text-xs">Remove</button>
            </form>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Connect an account</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {LIVE_PLATFORMS.filter((p) => p.connect === "oauth").map((p) => {
            const missing = missingEnv(p.id);
            return (
              <div key={p.id} className="card flex items-center gap-3">
                <PlatformIcon platform={p.id} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted">
                    {missing.length
                      ? <>Needs <code className="font-mono">{missing.join(", ")}</code> set on the server. See the README.</>
                      : `Opens ${p.name} to sign in. Make sure you're signed into ${ws.name}'s account there, not another project's.`}
                  </div>
                </div>
                {missing.length === 0 && (
                  <a href={`/api/oauth/${p.id}/start?workspace=${slug}`} className="btn-primary shrink-0 px-3 py-1.5 text-xs">Connect</a>
                )}
              </div>
            );
          })}
          {LIVE_PLATFORMS.filter((p) => p.connect === "form").map((p) => (
            <details key={p.id} open={openPlatform === p.id || accounts.length === 0} className="card group">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <PlatformIcon platform={p.id} />
                <span className="font-medium">{p.name}</span>
                <span className="ml-auto text-xs text-muted group-open:hidden">Connect</span>
              </summary>
              <form action={connect} className="mt-4 space-y-3">
                <input type="hidden" name="platform" value={p.id} />
                {p.id === "bluesky" && (
                  <>
                    <div>
                      <label className="field-label">Handle</label>
                      <input name="identifier" required placeholder="5kable.bsky.social" className="input" autoComplete="off" />
                    </div>
                    <div>
                      <label className="field-label">App password</label>
                      <input name="app_password" required placeholder="xxxx-xxxx-xxxx-xxxx" className="input font-mono" autoComplete="off" />
                      <p className="mt-1 text-xs text-subtle">Bluesky → Settings → Privacy and security → App passwords. Not your login password.</p>
                    </div>
                  </>
                )}
                {p.id === "discord" && (
                  <div>
                    <label className="field-label">Webhook URL</label>
                    <input name="webhook_url" required type="url" placeholder="https://discord.com/api/webhooks/…" className="input font-mono" autoComplete="off" />
                    <p className="mt-1 text-xs text-subtle">Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</p>
                  </div>
                )}
                <div>
                  <label className="field-label">Label (optional)</label>
                  <input name="label" maxLength={100} placeholder="Shown in the composer" className="input" />
                </div>
                <SubmitButton pendingText="Checking…">Connect {p.name}</SubmitButton>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Coming next</h2>
        <p className="text-sm text-muted">These need a developer app registered with each platform before they can be connected.</p>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.filter((p) => p.status === "planned").map((p) => (
            <span key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted">
              <PlatformIcon platform={p.id} size={20} /> {p.name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
