"use client";

import { useMemo, useState } from "react";
import { PlatformIcon } from "@/components/platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { getPlatform, postLength } from "@/lib/platforms/catalog";
import type { Account } from "@/lib/types";

type Props = {
  accounts: Pick<Account, "id" | "platform" | "label" | "status">[];
  action: (formData: FormData) => Promise<void>;
};

function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function Composer({ accounts, action }: Props) {
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(accounts.filter((a) => a.status === "connected").map((a) => a.id)));
  const [when, setWhen] = useState<"now" | "later">("now");
  const [localTime, setLocalTime] = useState(() => localInputValue(new Date(Date.now() + 60 * 60 * 1000)));

  const limits = useMemo(
    () =>
      accounts
        .filter((a) => selected.has(a.id))
        .map((a) => {
          const p = getPlatform(a.platform)!;
          return { account: a, platform: p, length: postLength(p, body) };
        }),
    [accounts, selected, body],
  );
  const overLimit = limits.filter((l) => l.length > l.platform.maxLength);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action} className="card space-y-4">
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        maxLength={5000}
        placeholder="What's new?"
        className="input resize-y text-base"
      />

      <div>
        <div className="field-label">Post to</div>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const on = selected.has(a.id);
            const limit = limits.find((l) => l.account.id === a.id);
            const over = limit && limit.length > limit.platform.maxLength;
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition ${
                  on ? (over ? "border-bad bg-bad/10" : "border-accent bg-accent/10") : "border-line opacity-60 hover:opacity-100"
                }`}
              >
                <input type="checkbox" name="account_ids" value={a.id} checked={on} onChange={() => toggle(a.id)} className="sr-only" />
                <PlatformIcon platform={a.platform} size={20} />
                <span>{a.label}</span>
                {on && limit && (
                  <span className={`font-mono text-xs ${over ? "text-bad" : "text-subtle"}`}>
                    {limit.platform.maxLength - limit.length}
                  </span>
                )}
                {a.status === "error" && <span className="badge bg-warn/15 text-warn">check</span>}
              </label>
            );
          })}
        </div>
      </div>

      {overLimit.length > 0 && (
        <p className="notice-error">
          Too long for {overLimit.map((l) => `${l.platform.name} (${l.platform.maxLength})`).join(", ")}. Shorten it or untick those accounts.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <div className="flex rounded-lg border border-line p-0.5 text-sm">
          {(["now", "later"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWhen(w)}
              className={`rounded-md px-3 py-1 ${when === w ? "bg-raised text-fg" : "text-muted"}`}
            >
              {w === "now" ? "Post now" : "Schedule"}
            </button>
          ))}
        </div>
        <input type="hidden" name="when" value={when} />
        {when === "later" && (
          <>
            <input
              type="datetime-local"
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
              className="input w-auto"
              required
            />
            {/* The browser knows the user's timezone; the server gets an unambiguous UTC time. */}
            <input type="hidden" name="scheduled_at" value={localTime ? new Date(localTime).toISOString() : ""} />
          </>
        )}
        <SubmitButton
          className="btn-primary ml-auto"
          pendingText={when === "now" ? "Posting…" : "Scheduling…"}
          disabled={!body.trim() || selected.size === 0 || overLimit.length > 0}
        >
          {when === "now" ? `Post to ${selected.size}` : `Schedule for ${selected.size}`}
        </SubmitButton>
      </div>
    </form>
  );
}
