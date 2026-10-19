import { MetricLine } from "@/components/metric-line";
import { SubmitButton } from "@/components/submit-button";
import { bestTimes, MIN_POSTS_FOR_BEST_TIMES } from "@/lib/best-times";
import { addSlots } from "../preferences/actions";
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

  // Per post, across all its accounts, over both 30-day windows for more history.
  const perPost = new Map<string, { sentAt: Date; interactions: number }>();
  for (const r of rows.filter((x) => x.metrics)) {
    const prev = perPost.get(r.post.id);
    const sentAt = new Date(r.sent_at);
    perPost.set(r.post.id, {
      sentAt: prev && prev.sentAt < sentAt ? prev.sentAt : sentAt,
      interactions: (prev?.interactions ?? 0) + engagement(r.metrics),
    });
  }
  const best = bestTimes([...perPost.values()], ws.timezone);

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
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Last 30 days</h1>
          <a href={`/w/${slug}/export`} className="btn-ghost ml-auto px-3 py-1 text-xs" download>
            Export all posts (CSV)
          </a>
        </div>
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

          <section className="space-y-3">
            <h2 className="font-semibold">Best times to post</h2>
            {best.length === 0 ? (
              <p className="text-sm text-muted">
                Needs at least {MIN_POSTS_FOR_BEST_TIMES} posts with numbers ({perPost.size} so far). Until then, post at a mix of times so there&apos;s something to compare.
              </p>
            ) : (
              <>
                <ol className="card divide-y divide-line p-0">
                  {best.map((b, i) => (
                    <li key={b.label} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="w-5 text-subtle">{i + 1}</span>
                      <span className="w-28 font-medium">{b.label}</span>
                      <span className="flex-1 text-muted">
                        {b.average.toFixed(b.average < 10 ? 1 : 0)} interactions per post on average · {b.posts} post{b.posts === 1 ? "" : "s"}
                      </span>
                      {ws.role === "owner" && (
                        <form action={addSlots.bind(null, slug)}>
                          <input type="hidden" name="weekday" value={b.weekday} />
                          <input type="hidden" name="time" value={`${String(b.hour).padStart(2, "0")}:00`} />
                          <SubmitButton className="btn-ghost px-2.5 py-1 text-xs" pendingText="Adding…">Add as posting slot</SubmitButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-subtle">
                  From the last 60 days, in {ws.timezone}. Slots with only one post are a hint rather than a pattern.
                </p>
              </>
            )}
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
