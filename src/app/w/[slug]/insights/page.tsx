import { MetricLine } from "@/components/metric-line";
import { PlatformIcon } from "@/components/platform-icon";
import { compact, full } from "@/lib/format-number";
import { getPlatform, type PlatformId } from "@/lib/platforms/catalog";
import type { Metrics } from "@/lib/platforms/adapters/shared";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Insights" };

const DAY = 86_400_000;
const KEYS = ["views", "likes", "comments", "shares"] as const;
type Key = (typeof KEYS)[number];
const LABEL: Record<Key, string> = { views: "Views", likes: "Likes", comments: "Comments", shares: "Shares" };

type Row = {
  sent_at: string;
  metrics: Metrics | null;
  remote_url: string | null;
  account: { platform: PlatformId; label: string } | null;
  post: { id: string; body: string; workspace_id: string };
};

const sum = (rows: Row[], key: Key) => rows.reduce((n, r) => n + (r.metrics?.[key] ?? 0), 0);
const engagement = (m: Metrics | null) => (m?.likes ?? 0) + (m?.comments ?? 0) + (m?.shares ?? 0);

export default async function InsightsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  const now = Date.now();
  const { data } = await supabase
    .from("post_targets")
    .select("sent_at, metrics, remote_url, account:accounts(platform, label), post:posts!inner(id, body, workspace_id)")
    .eq("post.workspace_id", ws.id)
    .eq("status", "sent")
    .gte("sent_at", new Date(now - 60 * DAY).toISOString())
    .returns<Row[]>();

  const rows = data ?? [];
  const current = rows.filter((r) => new Date(r.sent_at).getTime() >= now - 30 * DAY);
  const previous = rows.filter((r) => new Date(r.sent_at).getTime() < now - 30 * DAY);
  const measured = current.filter((r) => r.metrics);
  const postCount = new Set(current.map((r) => r.post.id)).size;

  const byPlatform = new Map<PlatformId, Row[]>();
  for (const r of current) if (r.account) byPlatform.set(r.account.platform, [...(byPlatform.get(r.account.platform) ?? []), r]);

  const byPost = new Map<string, { body: string; rows: Row[] }>();
  for (const r of measured) byPost.set(r.post.id, { body: r.post.body, rows: [...(byPost.get(r.post.id)?.rows ?? []), r] });
  const top = [...byPost.values()]
    .map((p) => ({ ...p, total: p.rows.reduce((n, r) => n + engagement(r.metrics), 0) }))
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Last 30 days</h1>
        <p className="text-sm text-muted">
          {postCount} post{postCount === 1 ? "" : "s"} sent across {byPlatform.size} platform{byPlatform.size === 1 ? "" : "s"}. Numbers update
          hourly for a day after posting, then every six hours for two weeks.
        </p>
      </div>

      {measured.length === 0 ? (
        <div className="card text-sm text-muted">
          No numbers yet. Once posts have gone out, likes, comments, shares and views appear here within the hour. Discord doesn&apos;t report
          any, and accounts connected before stats were added may need reconnecting.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {KEYS.map((k) => {
              const value = sum(current, k);
              const before = sum(previous, k);
              const delta = before > 0 ? Math.round(((value - before) / before) * 100) : null;
              // Zero and "nobody reports this" are different things; don't show the second as 0.
              const reported = current.some((r) => r.metrics?.[k] !== undefined);
              return (
                <div key={k} className="card space-y-1 p-4">
                  <div className="text-xs text-muted">{LABEL[k]}</div>
                  <div className="text-2xl font-semibold" title={reported ? full(value) : undefined}>{reported ? compact(value) : "–"}</div>
                  <div className="text-xs text-subtle">
                    {!reported ? (
                      "Not reported by these platforms"
                    ) : delta === null ? (
                      "No earlier period to compare"
                    ) : (
                      <>
                        <span className={delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : ""}>
                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {delta > 0 ? "+" : ""}{delta}%
                        </span>{" "}
                        vs previous 30 days
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <section className="space-y-3">
            <h2 className="font-semibold">By platform</h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Platform</th>
                    <th className="px-4 py-2 text-right font-medium">Posts</th>
                    {KEYS.map((k) => <th key={k} className="px-4 py-2 text-right font-medium">{LABEL[k]}</th>)}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...byPlatform.entries()]
                    .sort((a, b) => sum(b[1], "likes") - sum(a[1], "likes"))
                    .map(([platform, list]) => (
                      <tr key={platform} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-2"><PlatformIcon platform={platform} size={18} />{getPlatform(platform)?.name}</span>
                        </td>
                        <td className="px-4 py-2 text-right">{list.length}</td>
                        {KEYS.map((k) => {
                          const reported = list.some((r) => r.metrics?.[k] !== undefined);
                          return <td key={k} className="px-4 py-2 text-right">{reported ? full(sum(list, k)) : <span className="text-subtle">–</span>}</td>;
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-subtle">– means the platform doesn&apos;t report that number. Reddit&apos;s &ldquo;likes&rdquo; are its score (upvotes minus downvotes).</p>
          </section>

          {top.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold">Top posts</h2>
              <ol className="space-y-2">
                {top.map((p, i) => (
                  <li key={i} className="card flex gap-4 p-4">
                    <span className="text-lg font-semibold text-subtle">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="line-clamp-2 text-sm">{p.body || "(attachments only)"}</p>
                      <div className="flex flex-wrap gap-2">
                        {p.rows.map((r, j) => (
                          <a key={j} href={r.remote_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs hover:border-accent">
                            {r.account && <PlatformIcon platform={r.account.platform} size={14} />}
                            <MetricLine m={r.metrics} />
                          </a>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold" title={full(p.total)}>{compact(p.total)}</div>
                      <div className="text-xs text-muted">interactions</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
