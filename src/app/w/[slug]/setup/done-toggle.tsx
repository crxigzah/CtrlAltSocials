"use client";

import { useOptimistic, useTransition } from "react";
import { toggleSetup } from "../actions";

export function DoneToggle({ slug, platform, done }: { slug: string; platform: string; done: boolean }) {
  const [, start] = useTransition();
  // Flip straight away; the server catches up and the page re-renders with the saved state.
  const [checked, setChecked] = useOptimistic(done);
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          const next = e.target.checked;
          start(async () => {
            setChecked(next);
            await toggleSetup(slug, platform, next);
          });
        }}
        className="accent-[var(--color-accent)]"
      />
      Signed up
    </label>
  );
}
