import Link from "next/link";
import { PlatformIcon } from "@/components/platform-icon";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/workspace";
import { CopyButton } from "./copy-button";
import { DoneToggle } from "./done-toggle";

export const metadata = { title: "Setup checklist" };

export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  const [{ data: progress }, { data: accounts }] = await Promise.all([
    supabase.from("setup_progress").select("platform").eq("workspace_id", ws.id),
    supabase.from("accounts").select("platform").eq("workspace_id", ws.id),
  ]);
  const done = new Set((progress ?? []).map((r) => r.platform));
  const connected = new Set((accounts ?? []).map((r) => r.platform));
  const doneCount = PLATFORMS.filter((p) => done.has(p.id) || connected.has(p.id)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Set up {ws.name}&apos;s accounts</h1>
          <p className="max-w-2xl text-sm text-muted">
            Sign up to each platform yourself (about two minutes each) using the details below, then tick it off. Use a private
            window or a separate browser profile for this project so you don&apos;t sign up while logged into another project&apos;s account.
          </p>
        </div>
        <span className="text-sm text-muted">{doneCount} of {PLATFORMS.length} done</span>
      </div>

      {!ws.handle && (
        <p className="notice-error">
          No handle set yet. <Link href={`/w/${slug}/settings`} className="underline">Fill in the brand kit</Link> first so everything&apos;s ready to copy.
        </p>
      )}

      <div className="card grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Handle" value={ws.handle ? `${ws.handle}` : null} />
        <Detail label="Sign-up email" value={ws.signup_email} />
        <Detail label="Website" value={ws.website} />
        <Detail label="Display name" value={ws.name} />
        <div className="sm:col-span-2"><Detail label="Bio" value={ws.bio} /></div>
      </div>

      <ul className="space-y-3">
        {PLATFORMS.map((p) => {
          const isConnected = connected.has(p.id);
          const isDone = isConnected || done.has(p.id);
          const handleTooLong = ws.handle && ws.handle.length > p.handleMax;
          const bioTooLong = ws.bio && ws.bio.length > p.bioMax;
          return (
            <li key={p.id} className={`card flex gap-4 p-4 ${isDone ? "opacity-60" : ""}`}>
              <PlatformIcon platform={p.id} size={36} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {isConnected && <span className="badge bg-ok/15 text-ok">Connected</span>}
                  {p.status === "planned" && <span className="badge bg-raised text-muted">Posting coming soon</span>}
                </div>
                <p className="text-sm text-muted">{p.signupTip}</p>
                {handleTooLong && <p className="text-xs text-warn">Handle is longer than {p.name}&apos;s {p.handleMax}-character limit; you&apos;ll need a shorter one there.</p>}
                {bioTooLong && <p className="text-xs text-warn">Bio is over {p.name}&apos;s {p.bioMax}-character limit; trim it when pasting.</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <a href={p.signupUrl} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1 text-xs">Open sign-up ↗</a>
                {!isConnected && <DoneToggle slug={slug} platform={p.id} done={done.has(p.id)} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      {value ? (
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words font-mono text-xs">{value}</span>
          <CopyButton value={value} />
        </div>
      ) : (
        <span className="text-xs text-subtle">Not set</span>
      )}
    </div>
  );
}
