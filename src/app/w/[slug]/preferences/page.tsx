import { SubmitButton } from "@/components/submit-button";
import { formatMinute, nextFreeSlot, WEEKDAYS } from "@/lib/slots";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { addSlots, addSnippet, removeSlot, removeSnippet, setAlertWebhook, setTimezone } from "./actions";

export const metadata = { title: "Settings" };

export default async function PreferencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { slug } = await params;
  const { error, saved } = await searchParams;
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  const [{ data: slots }, { data: snippets }, { data: queued }] = await Promise.all([
    supabase.from("posting_slots").select("id, weekday, minute_of_day").eq("workspace_id", ws.id).order("minute_of_day"),
    supabase.from("snippets").select("id, name, body").eq("workspace_id", ws.id).order("created_at"),
    supabase.from("posts").select("scheduled_at").eq("workspace_id", ws.id).eq("status", "scheduled").gte("scheduled_at", new Date().toISOString()),
  ]);
  const next = nextFreeSlot(slots ?? [], ws.timezone, (queued ?? []).map((p) => new Date(p.scheduled_at)));
  const byTime = new Map<number, { id: string; weekday: number }[]>();
  for (const s of slots ?? []) byTime.set(s.minute_of_day, [...(byTime.get(s.minute_of_day) ?? []), s]);

  return (
    <div className="max-w-2xl space-y-8">
      {error && <p className="notice-error">{error}</p>}
      {saved && <p className="notice-ok">{saved}</p>}

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
