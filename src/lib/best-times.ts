import { WEEKDAYS } from "@/lib/slots";

// Which weekday-and-hour posts have done best, from the numbers Insights collects.
// Deliberately simple: average interactions per post in each slot, only once there's
// enough history for it to mean something.

export type TimedResult = { sentAt: Date; interactions: number };
export type BestTime = { weekday: number; hour: number; label: string; average: number; posts: number };

export const MIN_POSTS_FOR_BEST_TIMES = 6;

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return {
    weekday: WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")!.value) + 1,
    hour: Number(parts.find((p) => p.type === "hour")!.value),
  };
}

export function bestTimes(results: TimedResult[], timeZone: string, top = 3): BestTime[] {
  if (results.length < MIN_POSTS_FOR_BEST_TIMES) return [];
  const buckets = new Map<string, { weekday: number; hour: number; total: number; posts: number }>();
  for (const r of results) {
    const { weekday, hour } = localParts(r.sentAt, timeZone);
    const key = `${weekday}-${hour}`;
    const b = buckets.get(key) ?? { weekday, hour, total: 0, posts: 0 };
    b.total += r.interactions;
    b.posts += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .map((b) => ({
      weekday: b.weekday,
      hour: b.hour,
      label: `${WEEKDAYS[b.weekday - 1]} ${String(b.hour).padStart(2, "0")}:00`,
      average: b.total / b.posts,
      posts: b.posts,
    }))
    .sort((a, b) => b.average - a.average || b.posts - a.posts)
    .slice(0, top);
}
