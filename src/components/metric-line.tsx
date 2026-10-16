import { compact } from "@/lib/format-number";
import type { Metrics } from "@/lib/platforms/adapters/shared";

/** "1.2K views · 34 likes · 5 comments", leaving out numbers the platform doesn't report. */
export function MetricLine({ m }: { m: Metrics | null }) {
  if (!m) return <span className="text-subtle">no numbers yet</span>;
  const parts = [
    m.views !== undefined && `${compact(m.views)} views`,
    m.likes !== undefined && `${compact(m.likes)} likes`,
    m.comments !== undefined && `${compact(m.comments)} comments`,
    m.shares !== undefined && `${compact(m.shares)} shares`,
  ].filter(Boolean);
  return <span className="text-muted">{parts.join(" · ") || "no numbers"}</span>;
}
