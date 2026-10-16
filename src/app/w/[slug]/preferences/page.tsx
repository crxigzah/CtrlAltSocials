import { SubmitButton } from "@/components/submit-button";
import { formatMinute, nextFreeSlot, WEEKDAYS } from "@/lib/slots";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/workspace";
import { CopyButton } from "../setup/copy-button";
import { createAdminClient } from "@/lib/supabase/admin";
import { addSlots, addSnippet, createInvite, removeMember, removeSlot, removeSnippet, revokeInvite, setAlertWebhook, setLinkTracking, setTimezone } from "./actions";

export const metadata = { title: "Settings" };

export default async function PreferencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; saved?: string; invite?: string }>;
}) {
  const { slug } = await params;
  const { error, saved, invite } = await searchParams;
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  const [{ data: slots }, { data: snippets }, { data: queued }] = await Promise.all([
    supabase.from("posting_slots").select("id, weekday, minute_of_day").eq("workspace_id", ws.id).order("minute_of_day"),
    supabase.from("snippets").select("id, name, body").eq("workspace_id", ws.id).order("created_at"),
    supabase.from("posts").select("scheduled_at").eq("workspace_id", ws.id).eq("status", "scheduled").gte("scheduled_at", new Date().toISOString()),
  ]);
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", ws.id).order("created_at"),
    supabase.from("workspace_invites").select("id, email, expires_at").eq("workspace_id", ws.id).gt("expires_at", new Date().toISOString()).order("created_at"),
  ]);
  // Emails live in Supabase Auth, which only the service role can read; this page is owner-only.
  const admin = createAdminClient();
  const emails = new Map<string, string>();
  for (const m of members ?? []) {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    if (data.user?.email) emails.set(m.user_id, data.user.email);
  }
  const inviteUrl = invite ? `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/invite/${invite}` : null;
  const next = nextFreeSlot(slots ?? [], ws.timezone, (queued ?? []).map((p) => new Date(p.scheduled_at)));
  const byTime = new Map<number, { id: string; weekday: number }[]>();
  for (const s of slots ?? []) byTime.set(s.minute_of_day, [...(byTime.get(s.minute_of_day) ?? []), s]);

  return (
    <div className="max-w-2xl space-y-8">
      {error && <p className="notice-error">{error}</p>}
      {saved && <p className="notice-ok">{saved}</p>}

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Members</h2>
          <p className="text-sm text-muted">
            Editors can write, schedule and import posts and see insights. Only you can connect accounts or change settings.
          </p>
        </div>
        {inviteUrl && (
          <div className="space-y-2 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm">
            <p className="text-ok">Invite link created. Send it to them; it works once and expires in 7 days. You won&apos;t see it again.</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{inviteUrl}</code>
              <CopyButton value={inviteUrl} />
            </div>
            {!process.env.APP_URL && <p className="text-xs text-warn">APP_URL isn&apos;t set, so add your site&apos;s address in front of /invite/….</p>}
            {process.env.ALLOWED_EMAILS?.trim() && <p className="text-xs text-warn">ALLOWED_EMAILS is set, so add their email to it too or they won&apos;t be let in.</p>}
          </div>
        )}
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{emails.get(m.user_id) ?? "Unknown user"}</span>
              <span className={`badge ${m.role === "owner" ? "bg-accent/15 text-accent" : "bg-raised text-muted"}`}>{m.role === "owner" ? "Owner" : "Editor"}</span>
              {m.role !== "owner" && (
                <form action={removeMember.bind(null, slug, m.user_id)}>
                  <button className="text-xs text-muted hover:text-bad">Remove</button>
                </form>
              )}
            </li>
          ))}
          {(invites ?? []).map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-muted">
              <span className="min-w-0 flex-1 truncate">Invite{i.email ? ` for ${i.email}` : ""} (unused)</span>
              <span className="text-xs">expires {new Date(i.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              <form action={revokeInvite.bind(null, slug, i.id)}>
                <button className="text-xs hover:text-bad">Cancel</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createInvite.bind(null, slug)} className="flex flex-wrap gap-2">
          <input name="email" type="email" placeholder="Their email (optional: locks the link to it)" className="input min-w-0 flex-1" />
          <SubmitButton className="btn-ghost" pendingText="Creating…">Create invite link</SubmitButton>
        </form>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Posting slots</h2>
          <p className="text-sm text-muted">
            Regular times for {ws.name}&apos;s posts. &ldquo;Add to queue&rdquo; in the composer drops a post into the next free one.
          </p>
        </div>
        {byTime.size === 0 ? (
          <p className="text-sm text-subtle">No slots yet.</p>
        ) : (
          <ul className="space-y-2">
            {[...byTime.entries()].map(([minute, entries]) => (
              <li key={minute} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-14 font-mono">{formatMinute(minute)}</span>
                {entries
                  .sort((a, b) => a.weekday - b.weekday)
                  .map((e) => (
                    <form key={e.id} action={removeSlot.bind(null, slug, e.id)}>
                      <button className="badge border border-line bg-raised hover:border-bad hover:text-bad" title="Remove this slot">
                        {WEEKDAYS[e.weekday - 1]} ✕
                      </button>
                    </form>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {next && (
          <p className="text-xs text-muted">
            Next free slot: {next.toLocaleString("en-GB", { timeZone: ws.timezone, weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} ({ws.timezone})
          </p>
        )}
        <form action={addSlots.bind(null, slug)} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="flex cursor-pointer items-center gap-1 rounded-md border border-line px-2 py-1 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent/10">
                <input type="checkbox" name="weekday" value={i + 1} defaultChecked={i < 5} className="sr-only" />
                {d}
              </label>
            ))}
          </div>
          <input type="time" name="time" required defaultValue="12:00" className="input w-auto px-2 py-1" />
          <SubmitButton className="btn-ghost px-3 py-1 text-xs" pendingText="Adding…">Add slots</SubmitButton>
        </form>
        <form action={setTimezone.bind(null, slug)} className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="timezone" className="text-xs text-muted">Timezone</label>
          <input id="timezone" name="timezone" defaultValue={ws.timezone} className="input w-56 px-2 py-1" list="timezones" />
          <datalist id="timezones">
            {["Europe/London", "Europe/Dublin", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "Asia/Tokyo", "UTC"].map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
          <SubmitButton className="btn-ghost px-3 py-1 text-xs" pendingText="Saving…">Save</SubmitButton>
        </form>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Failure alerts</h2>
          <p className="text-sm text-muted">
            If a scheduled post fails, get a message in a Discord channel with what went wrong. Create a webhook in a private channel
            (Server Settings → Integrations → Webhooks) and paste it here. Leave it empty to turn alerts off.
          </p>
        </div>
        <p className="text-sm">{ws.alert_webhook ? "✅ Alerts are on." : "Alerts are off."}</p>
        <form action={setAlertWebhook.bind(null, slug)} className="flex flex-wrap gap-2">
          <input name="webhook_url" type="url" placeholder="https://discord.com/api/webhooks/…" className="input min-w-0 flex-1 font-mono" autoComplete="off" />
          <SubmitButton className="btn-ghost" pendingText="Testing…">{ws.alert_webhook ? "Replace" : "Turn on"}</SubmitButton>
        </form>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Link tracking</h2>
          <p className="text-sm text-muted">
            Adds <code className="font-mono text-xs">utm_source</code>, <code className="font-mono text-xs">utm_medium</code> and{" "}
            <code className="font-mono text-xs">utm_campaign</code> to links to {ws.website ?? "the project's website"} as each post goes out, so your
            site&apos;s analytics shows which platform sent each visitor. Other links are left alone. On Bluesky the visible link stays clean.
          </p>
        </div>
        <form action={setLinkTracking.bind(null, slug)} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="utm_enabled" defaultChecked={ws.utm_enabled} className="accent-[var(--color-accent)]" />
            Tag links
          </label>
          <input name="utm_campaign" defaultValue={ws.utm_campaign ?? ""} placeholder="campaign (default: ctrlaltsocials)" className="input w-64 px-2 py-1" />
          <SubmitButton className="btn-ghost px-3 py-1 text-xs" pendingText="Saving…">Save</SubmitButton>
        </form>
        {ws.utm_enabled && ws.website && (
          <p className="text-xs text-subtle font-mono break-all">
            e.g. {ws.website.replace(/\/$/, "")}/page?utm_source=bluesky&amp;utm_medium=social&amp;utm_campaign={ws.utm_campaign || "ctrlaltsocials"}
          </p>
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Snippets</h2>
          <p className="text-sm text-muted">Hashtag sets, sign-offs and links you use a lot. Insert them from the composer with one click.</p>
        </div>
        {(snippets ?? []).length > 0 && (
          <ul className="space-y-2">
            {snippets!.map((s) => (
              <li key={s.id} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="whitespace-pre-wrap break-words text-xs text-muted">{s.body}</div>
                </div>
                <form action={removeSnippet.bind(null, slug, s.id)}>
                  <button className="text-xs text-muted hover:text-bad">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addSnippet.bind(null, slug)} className="space-y-2 border-t border-line pt-4">
          <input name="name" required maxLength={60} placeholder="Name, e.g. GeoGuessr hashtags" className="input" />
          <textarea name="body" required maxLength={2000} rows={2} placeholder="#GeoGuessr #geography #5kable" className="input" />
          <SubmitButton className="btn-ghost" pendingText="Saving…">Save snippet</SubmitButton>
        </form>
      </section>
    </div>
  );
}
