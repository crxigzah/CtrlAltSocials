"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseCsv } from "@/lib/csv";
import { planImport, type PlannedPost } from "@/lib/import-plan";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export type PreviewState = {
  csv: string;
  error?: string;
  rows?: (Omit<PlannedPost, "at"> & { at: string | null; accountLabels: string[] })[];
};

async function plan(slug: string, csv: string) {
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  const [{ data: accounts }, { data: slots }, { data: queued }] = await Promise.all([
    supabase.from("accounts").select("id, platform, label").eq("workspace_id", ws.id),
    supabase.from("posting_slots").select("weekday, minute_of_day").eq("workspace_id", ws.id),
    supabase.from("posts").select("scheduled_at").eq("workspace_id", ws.id).eq("status", "scheduled").gte("scheduled_at", new Date().toISOString()),
  ]);
  const result = planImport(parseCsv(csv), {
    accounts: accounts ?? [],
    timeZone: ws.timezone,
    slots: slots ?? [],
    taken: (queued ?? []).map((p) => new Date(p.scheduled_at)),
  });
  return { ws, supabase, accounts: accounts ?? [], ...result };
}

/** Step 1: check the spreadsheet and show what would happen, without creating anything. */
export async function previewImport(slug: string, _prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const csv = String(formData.get("csv") ?? "").slice(0, 500_000);
  if (!csv.trim()) return { csv, error: "Paste a spreadsheet or choose a CSV file first." };
  const { posts, error, accounts } = await plan(slug, csv);
  if (error) return { csv, error };
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  return { csv, rows: posts.map((p) => ({ ...p, at: p.at?.toISOString() ?? null, accountLabels: p.accountIds.map(label) })) };
}

/** Step 2: create every row without problems. Re-plans from the CSV so nothing from the browser is trusted. */
export async function commitImport(slug: string, formData: FormData) {
  const csv = String(formData.get("csv") ?? "").slice(0, 500_000);
  const { ws, supabase, posts, error } = await plan(slug, csv);
  if (error) redirect(`/w/${slug}/import?error=${encodeURIComponent(error)}`);

  let created = 0;
  for (const p of posts.filter((x) => x.problems.length === 0)) {
    const { data: post } = await supabase
      .from("posts")
      .insert({
        workspace_id: ws.id,
        body: p.text,
        status: p.mode === "draft" ? "draft" : "scheduled",
        scheduled_at: (p.at ?? new Date()).toISOString(),
        repeat: p.repeat,
      })
      .select("id")
      .single();
    if (!post) continue;
    if (p.accountIds.length) await supabase.from("post_targets").insert(p.accountIds.map((account_id) => ({ post_id: post.id, account_id })));
    created++;
  }
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}?imported=${created}`);
}
