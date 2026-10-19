import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "@/lib/alerts";
import { WEEKDAYS } from "@/lib/slots";

// Monday-morning recap in each project's alert channel: what went out last week,
// what didn't, the best post, and what's coming up. Sent once a week per project,
// tracked in system_heartbeat so overlapping scheduler runs can't double-send.

const DAY = 86_400_000;

function isMondayMorning(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")!.value) + 1;
  return weekday === 1 && Number(parts.find((p) => p.type === "hour")!.value) >= 9;
}

type TargetRow = { status: string; metrics: { likes?: number; comments?: number; shares?: number } | null; post: { id: string; body: string } };

export async function buildSummary(admin: SupabaseClient, ws: { id: string; name: string; slug: string }, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const [{ data: targets }, { count: upcoming }] = await Promise.all([
    admin
      .from("post_targets")
      .select("status, metrics, post:posts!inner(id, body, workspace_id, scheduled_at)")
      .eq("post.workspace_id", ws.id)
      .gte("post.scheduled_at", weekAgo)
      .lte("post.scheduled_at", now.toISOString())
      .in("status", ["sent", "failed"])
      .returns<TargetRow[]>(),
    admin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws.id)
      .eq("status", "scheduled")
      .gte("scheduled_at", now.toISOString())
      .lt("scheduled_at", new Date(now.getTime() + 7 * DAY).toISOString()),
  ]);

  const rows = targets ?? [];
  // A post "went out" if it reached at least one account.
  const sent = rows.filter((r) => r.status === "sent");
  const posts = new Set(sent.map((r) => r.post.id)).size;
  const failed = rows.length - sent.length;
  const score = new Map<string, { body: string; total: number }>();
  for (const r of sent) {
    const m = r.metrics ?? {};
    const prev = score.get(r.post.id) ?? { body: r.post.body, total: 0 };
    prev.total += (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
    score.set(r.post.id, prev);
  }
  const top = [...score.values()].sort((a, b) => b.total - a.total)[0];

  const lines = [`📊 **${ws.name}**: your week`];
  lines.push(posts ? `• ${posts} post${posts === 1 ? "" : "s"} went out (${sent.length} send${sent.length === 1 ? "" : "s"} across your accounts).` : "• Nothing went out last week.");
  if (failed) lines.push(`• ⚠️ ${failed} send${failed === 1 ? "" : "s"} failed. Check the post history.`);
  if (top && top.total > 0) lines.push(`• Best post (${top.total} interactions): "${(top.body || "(attachments only)").slice(0, 100).replace(/\n/g, " ")}"`);
  lines.push(upcoming ? `• ${upcoming} post${upcoming === 1 ? "" : "s"} scheduled for the week ahead.` : "• Nothing scheduled for the week ahead yet.");
  if (process.env.APP_URL) lines.push(`${process.env.APP_URL.replace(/\/$/, "")}/w/${ws.slug}/insights`);
  return lines.join("\n");
}

/** Called by the scheduler each run; does nothing except on Monday mornings. Returns how many were sent. */
export async function sendWeeklySummaries(admin: SupabaseClient, now = new Date()): Promise<number> {
  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, name, slug, timezone")
    .eq("weekly_summary", true)
    .not("alert_webhook", "is", null);
  let sent = 0;
  for (const ws of workspaces ?? []) {
    if (!isMondayMorning(now, ws.timezone)) continue;
    const name = `summary:${ws.id}`;
    // Claim this week's summary first (only if the last one is at least 6 days old), then send.
    const { data: last } = await admin.from("system_heartbeat").select("ran_at").eq("name", name).maybeSingle();
    if (last && now.getTime() - new Date(last.ran_at).getTime() < 6 * DAY) continue;
    const claim = last
      ? await admin.from("system_heartbeat").update({ ran_at: now.toISOString() }).eq("name", name).eq("ran_at", last.ran_at).select("name")
      : await admin.from("system_heartbeat").insert({ name, ran_at: now.toISOString() }).select("name");
    if (claim.error || !claim.data?.length) continue;
    await sendAlert(admin, ws.id, await buildSummary(admin, ws, now));
    sent++;
  }
  return sent;
}
