import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { CalendarGrid, type CalendarPost } from "./grid";

export const metadata = { title: "Calendar" };

function parseMonth(raw: string | undefined) {
  const m = raw?.match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : now.getUTCMonth();
  return month >= 0 && month < 12 ? { year, month } : { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

const monthParam = (year: number, month: number) => {
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { slug } = await params;
  const { year, month } = parseMonth((await searchParams).month);
  const ws = await getWorkspace(slug);
  const supabase = await createClient();

  // A week either side covers the leading/trailing days shown and any timezone offset.
  const from = new Date(Date.UTC(year, month, 1) - 7 * 86400_000).toISOString();
  const to = new Date(Date.UTC(year, month + 1, 1) + 7 * 86400_000).toISOString();
  const { data } = await supabase
    .from("posts")
    .select("id, body, status, scheduled_at, post_media(id), post_targets(account:accounts(platform))")
    .eq("workspace_id", ws.id)
    .neq("status", "draft")
    .gte("scheduled_at", from)
    .lt("scheduled_at", to)
    .order("scheduled_at");

  const posts: CalendarPost[] = (data ?? []).map((p) => ({
    id: p.id,
    body: p.body,
    status: p.status,
    at: p.scheduled_at,
    hasMedia: (p.post_media as unknown[]).length > 0,
    platforms: [
      ...new Set(
        (p.post_targets as unknown as { account: { platform: CalendarPost["platforms"][number] } | null }[])
          .map((t) => t.account?.platform)
          .filter((x): x is CalendarPost["platforms"][number] => Boolean(x)),
      ),
    ],
  }));
  const title = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="ml-auto flex gap-2">
          <Link href={`?month=${monthParam(year, month - 1)}`} className="btn-ghost px-3 py-1 text-xs">← Prev</Link>
          <Link href="?" className="btn-ghost px-3 py-1 text-xs">Today</Link>
          <Link href={`?month=${monthParam(year, month + 1)}`} className="btn-ghost px-3 py-1 text-xs">Next →</Link>
        </div>
      </div>
      <CalendarGrid slug={slug} year={year} month={month} posts={posts} />
    </div>
  );
}
