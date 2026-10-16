"use client";

import { useTransition } from "react";
import { toggleSetup } from "../actions";

export function DoneToggle({ slug, platform, done }: { slug: string; platform: string; done: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        checked={done}
        disabled={pending}
        onChange={(e) => start(() => toggleSetup(slug, platform, e.target.checked))}
        className="accent-[var(--color-accent)]"
      />
      Signed up
    </label>
  );
}
