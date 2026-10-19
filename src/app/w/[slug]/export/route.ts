import type { NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { getPlatform } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Row = {
  scheduled_at: string;
  status: string;
  body: string;
  thread_parts: string[];
  repeat: string | null;
  post_targets: {
    status: string;
    body: string | null;
    remote_url: string | null;
    error: string | null;
    metrics: { views?: number; likes?: number; comments?: number; shares?: number } | null;
    account: { label: string; platform: string } | null;
  }[];
};

/** The project's posts as a spreadsheet: one row per post per account, with results and numbers. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select("scheduled_at, status, body, thread_parts, repeat, post_targets(status, body, remote_url, error, metrics, account:accounts(label, platform))")
    .eq("workspace_id", ws.id)
    .order("scheduled_at", { ascending: false })
    .limit(5000)
    .returns<Row[]>();

  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: ws.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const rows: unknown[][] = [
    ["when", "post status", "text", "thread parts", "repeat", "account", "platform", "result", "link", "error or note", "views", "likes", "comments", "shares"],
  ];
  for (const p of data ?? []) {
    const base = [when(p.scheduled_at), p.status, p.body, (p.thread_parts ?? []).join("\n---\n"), p.repeat ?? ""];
    if (!p.post_targets.length) rows.push([...base, "", "", "", "", "", "", "", "", ""]);
    for (const t of p.post_targets) {
      const m = t.metrics ?? {};
      rows.push([
        ...base.slice(0, 2),
        t.body ?? p.body,
        ...base.slice(3),
        t.account?.label ?? "removed account",
        t.account ? getPlatform(t.account.platform)?.name ?? t.account.platform : "",
        t.status,
        t.remote_url ?? "",
        t.error ?? "",
        m.views ?? "",
        m.likes ?? "",
        m.comments ?? "",
        m.shares ?? "",
      ]);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ctrlaltsocials-${ws.slug}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
