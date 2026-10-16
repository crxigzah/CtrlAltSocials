import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { describeError, getAdapter } from "@/lib/platforms/adapters";

// Keeps each sent post's numbers up to date. Fresh posts are checked hourly for
// their first day, then every six hours, and not at all after two weeks: by then
// the numbers have settled and every lookup spends API quota.

const HOUR = 60 * 60 * 1000;

type Row = {
  id: string;
  remote_id: string;
  sent_at: string;
  metrics_at: string | null;
  account: { id: string; platform: string; credentials: string | null } | null;
};

function isDue(row: Row, now: number) {
  if (!row.metrics_at) return true;
  const age = now - new Date(row.sent_at).getTime();
  const since = now - new Date(row.metrics_at).getTime();
  return since >= (age < 24 * HOUR ? HOUR : 6 * HOUR);
}

/** Refreshes as many due posts as fit in the time budget. Returns how many were updated. */
export async function refreshMetrics(supabase: SupabaseClient, budgetMs: number): Promise<number> {
  const started = Date.now();
  const { data } = await supabase
    .from("post_targets")
    .select("id, remote_id, sent_at, metrics_at, account:accounts(id, platform, credentials)")
    .eq("status", "sent")
    .not("remote_id", "is", null)
    .gte("sent_at", new Date(started - 14 * 24 * HOUR).toISOString())
    .order("metrics_at", { ascending: true, nullsFirst: true })
    .limit(50)
    .returns<Row[]>();

  let updated = 0;
  for (const row of (data ?? []).filter((r) => isDue(r, started))) {
    if (Date.now() - started > budgetMs) break;
    const adapter = row.account ? getAdapter(row.account.platform) : undefined;
    // Platforms without numbers (Discord) still get a timestamp so they aren't re-checked every run.
    if (!adapter?.metrics || !row.account?.credentials) {
      await supabase.from("post_targets").update({ metrics_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }
    let credentials: unknown;
    try {
      const result = await adapter.metrics(decryptJson(row.account.credentials), row.remote_id);
      credentials = result.credentials;
      await supabase.from("post_targets").update({ metrics: result.metrics, metrics_at: new Date().toISOString() }).eq("id", row.id);
      updated++;
    } catch (err) {
      credentials = (err as { credentials?: unknown }).credentials;
      // Leave the old numbers; try again next interval rather than every minute.
      console.warn("metrics refresh failed", row.id, describeError(err));
      await supabase.from("post_targets").update({ metrics_at: new Date().toISOString() }).eq("id", row.id);
    }
    if (credentials !== undefined) {
      await supabase.from("accounts").update({ credentials: encryptJson(credentials) }).eq("id", row.account.id);
    }
  }
  return updated;
}
