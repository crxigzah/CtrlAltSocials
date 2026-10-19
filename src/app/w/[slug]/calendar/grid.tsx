"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { reschedulePost } from "../actions";
import { PlatformIcon } from "@/components/platform-icon";
import type { PlatformId } from "@/lib/platforms/catalog";
import type { PostStatus } from "@/lib/types";

export type CalendarPost = {
  id: string;
  body: string;
  status: PostStatus;
  at: string;
  hasMedia: boolean;
  platforms: PlatformId[];
};

const STATUS_CLS: Record<PostStatus, string> = {
  draft: "border-line bg-raised",
  pending_approval: "border-warn/50 bg-warn/5 border-dashed",
  scheduled: "border-accent/50 bg-accent/10",
  publishing: "border-warn/50 bg-warn/10",
  done: "border-ok/40 bg-ok/5",
  partial: "border-warn/50 bg-warn/10",
  failed: "border-bad/50 bg-bad/10",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Laid out in the viewer's own timezone, so a post at 00:30 BST lands on the right day. */
export function CalendarGrid({ slug, year, month, posts }: { slug: string; year: number; month: number; posts: CalendarPost[] }) {
  // Which day a post lands on depends on the viewer's timezone, which the server
  // doesn't know, so posts are only placed once we're in the browser.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(dayKey(new Date())), []);
  const mounted = today !== null;
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  // Optimistic positions while a move is saving.
  const [moved, setMoved] = useState<Record<string, string>>({});

  function drop(day: Date) {
    const id = dragging;
    setDragging(null);
    setOverDay(null);
    const post = posts.find((p) => p.id === id);
    if (!post) return;
    const from = new Date(moved[post.id] ?? post.at);
    // Same time of day, new date, in the viewer's own timezone.
    const to = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.getHours(), from.getMinutes());
    if (to.getTime() === from.getTime()) return;
    setMoved((m) => ({ ...m, [post.id]: to.toISOString() }));
    setMessage(null);
    startMove(async () => {
      const result = await reschedulePost(slug, post.id, to.toISOString());
      if (result.error) {
        setMoved((m) => {
          const next = { ...m };
          delete next[post.id];
          return next;
        });
        setMessage(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7)); // back to Monday
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  // Drop a trailing week that's entirely next month.
  const visible = days[35].getMonth() !== month ? days.slice(0, 35) : days;

  const byDay = new Map<string, CalendarPost[]>();
  for (const p of mounted ? posts : []) {
    const key = dayKey(new Date(moved[p.id] ?? p.at));
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }

  return (
    <div className="space-y-2">
    {message && <p className="notice-error">{message}</p>}
    <p className="text-xs text-subtle">
      Drag a scheduled post to another day to move it (same time of day).{moving && " Saving…"}
    </p>
    <div className="overflow-x-auto">
      <div className="grid min-w-[720px] grid-cols-7 overflow-hidden rounded-xl border border-line">
        {DAYS.map((d) => (
          <div key={d} className="border-b border-line bg-panel px-2 py-1.5 text-xs font-medium text-muted">{d}</div>
        ))}
        {visible.map((d, i) => {
          const key = dayKey(d);
          const inMonth = d.getMonth() === month;
          return (
            <div
              key={key}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOverDay(key);
              }}
              onDragLeave={() => setOverDay((d) => (d === key ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                drop(d);
              }}
              className={`min-h-28 space-y-1 border-line p-1.5 ${overDay === key ? "ring-2 ring-inset ring-accent" : ""} ${i % 7 !== 6 ? "border-r" : ""} ${i < visible.length - 7 ? "border-b" : ""} ${inMonth ? "bg-bg" : "bg-panel/50"}`}
            >
              <div className={`text-xs ${key === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg" : inMonth ? "text-muted" : "text-subtle"}`}>
                {d.getDate()}
              </div>
              {(byDay.get(key) ?? []).map((p) => {
                const time = new Date(p.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                const chip = (
                  <div className={`space-y-0.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight ${STATUS_CLS[p.status]}`} title={p.body}>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-subtle">{time}</span>
                      {p.platforms.map((pl) => <PlatformIcon key={pl} platform={pl} size={12} />)}
                      {p.hasMedia && <span aria-label="Has attachments">📎</span>}
                    </div>
                    <div className="line-clamp-2 text-fg">{p.body || "(attachments only)"}</div>
                  </div>
                );
                const movable = p.status === "scheduled" || p.status === "pending_approval";
                return movable ? (
                  <Link
                    key={p.id}
                    href={`/w/${slug}?edit=${p.id}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(p.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOverDay(null);
                    }}
                    className={`block cursor-grab hover:brightness-125 ${dragging === p.id ? "opacity-40" : ""}`}
                  >
                    {chip}
                  </Link>
                ) : (
                  <div key={p.id}>{chip}</div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
