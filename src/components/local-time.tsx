"use client";

import { useEffect, useState } from "react";

/** Renders in the viewer's own timezone; the server only knows UTC. */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }));
  }, [iso]);
  return <time dateTime={iso}>{text ?? ""}</time>;
}
