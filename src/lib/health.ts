import "server-only";
import { missingEnv } from "@/lib/platforms/adapters";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

// Everything a deployment needs, checked live, for the status page. Each check says
// what's wrong in plain English and what to do about it.

export type CheckState = "ok" | "warn" | "fail" | "off";
export type Check = { group: string; label: string; state: CheckState; detail: string };

/** One column per migration; the first missing one tells you how far behind the database is. */
const SCHEMA_PROBES: [string, string, string][] = [
  ["20261016000000_init", "posts", "id"],
  ["20261016000001_account_remote_id", "accounts", "remote_id"],
  ["20261016000002_media", "post_media", "id"],
  ["20261016000003_pending_connections", "pending_connections", "id"],
  ["20261016000004_target_overrides", "post_targets", "body"],
  ["20261016000005_reclaim_stuck_posts", "posts", "claimed_at"],
  ["20261017000000_queue_drafts_snippets_alerts", "posting_slots", "id"],
  ["20261017000001_post_metrics", "post_targets", "metrics"],
  ["20261018000000_threads_utm", "posts", "thread_parts"],
  ["20261019000000_heartbeat_recurring", "posts", "next_post_id"],
];

function ago(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "under a minute ago";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} hour${h === 1 ? "" : "s"} ago` : `${Math.round(h / 24)} days ago`;
}

export async function runHealthChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (group: string, label: string, state: CheckState, detail: string) => checks.push({ group, label, state, detail });
  const env = process.env;

  // --- Core settings -----------------------------------------------------------
  add("Core settings", "Supabase URL and anon key", env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "ok" : "fail",
    env.NEXT_PUBLIC_SUPABASE_URL ? "Set." : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from Supabase → Project Settings → API.");

  const keyBytes = env.CREDENTIALS_KEY ? Buffer.from(env.CREDENTIALS_KEY, "base64").length : 0;
  add("Core settings", "CREDENTIALS_KEY", keyBytes === 32 ? "ok" : "fail",
    keyBytes === 32 ? "A valid 32-byte key." : env.CREDENTIALS_KEY ? `It decodes to ${keyBytes} bytes; it must be 32. Generate one with: openssl rand -base64 32` : "Not set, so accounts can't be connected. Generate one with: openssl rand -base64 32");

  add("Core settings", "CRON_SECRET", !env.CRON_SECRET ? "fail" : env.CRON_SECRET.length < 16 ? "warn" : "ok",
    !env.CRON_SECRET ? "Not set, so scheduled posts can't go out. Generate one with: openssl rand -hex 32" : env.CRON_SECRET.length < 16 ? "Set, but short. Use a long random value (openssl rand -hex 32)." : "Set.");

  add("Core settings", "APP_URL", env.APP_URL ? "ok" : "warn",
    env.APP_URL ? env.APP_URL : "Not set. Sign-in platforms (X, Threads, Instagram…) need it for their redirect URLs, and alerts use it for links.");

  add("Core settings", "ALLOWED_EMAILS", env.ALLOWED_EMAILS?.trim() ? "ok" : "warn",
    env.ALLOWED_EMAILS?.trim() ? "Only the listed logins can use this deployment." : "Empty, so anyone who can create a login can use this deployment. Set it to your email.");

  // --- Database & storage ------------------------------------------------------
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    add("Database", "Service role key", "fail", "SUPABASE_SERVICE_ROLE_KEY isn't set, so the scheduler can't run and the database can't be checked.");
  } else {
    const admin = createAdminClient();
    const probe = await admin.from("system_heartbeat").select("name").limit(1);
    if (probe.error && /JWT|apikey|Invalid API key|permission/i.test(probe.error.message)) {
      add("Database", "Service role key", "fail", `Supabase rejected it: ${probe.error.message}`);
    } else {
      add("Database", "Service role key", "ok", "Works.");
      let missing: string | null = null;
      for (const [migration, table, column] of SCHEMA_PROBES) {
        const { error } = await admin.from(table).select(column).limit(0);
        if (error) {
          missing = migration;
          break;
        }
      }
      add("Database", "Migrations", missing ? "fail" : "ok",
        missing ? `${missing} hasn't been applied (nor any after it). Run: npx supabase db push, or run the remaining files in supabase/migrations in order.` : `All ${SCHEMA_PROBES.length} applied.`);

      const { data: bucket, error: bucketError } = await admin.storage.getBucket("media");
      add("Database", "Storage bucket", bucket && !bucket.public ? "ok" : bucket ? "warn" : "fail",
        bucket ? (bucket.public ? "The media bucket is public; it should be private." : "The private media bucket exists.") : `The media bucket is missing (${bucketError?.message ?? "not found"}). It's created by the media migration.`);

      // --- Scheduler ---------------------------------------------------------
      const { data: beat } = await admin.from("system_heartbeat").select("ran_at, detail").eq("name", "publisher").maybeSingle();
      if (!beat) {
        add("Scheduler", "Publisher", "fail", "Has never run. Set up the every-minute job from the README (Supabase pg_cron calling /api/cron/publish).");
      } else {
        const since = Date.now() - new Date(beat.ran_at).getTime();
        add("Scheduler", "Publisher", since < 3 * 60_000 ? "ok" : since < 30 * 60_000 ? "warn" : "fail",
          `Last ran ${ago(since)}.${since >= 3 * 60_000 ? " It should run every minute; check the pg_cron job and that its URL and secret match." : ""}`);
      }

      const { count: stuck } = await admin
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .lt("scheduled_at", new Date(Date.now() - 10 * 60_000).toISOString());
      add("Scheduler", "Overdue posts", stuck ? "warn" : "ok", stuck ? `${stuck} scheduled post${stuck === 1 ? " is" : "s are"} more than 10 minutes overdue.` : "None.");
    }
  }

  // --- Platforms ---------------------------------------------------------------
  for (const p of PLATFORMS.filter((x) => x.status === "live")) {
    if (p.connect === "form") {
      add("Platforms", p.name, "ok", "Needs no server setup; connect it from a project's Accounts tab.");
      continue;
    }
    const missing = missingEnv(p.id);
    add("Platforms", p.name, missing.length ? "off" : "ok", missing.length ? `Off until ${missing.join(" and ")} are set (see the README).` : "Configured.");
  }

  add("Extras", "Tailor with AI", env.ANTHROPIC_API_KEY ? "ok" : "off", env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY is set." : "Off. Set ANTHROPIC_API_KEY to enable it.");
  return checks;
}
