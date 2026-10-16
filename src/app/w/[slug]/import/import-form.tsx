"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { commitImport, previewImport, type PreviewState } from "./actions";

const EXAMPLE = `when,text,accounts,repeat
2026-10-20 18:00,"New Andorra guide is live https://5kable.com/guides/andorra",,
queue,Quiz time: which country uses yellow-bordered plates?,"bluesky, X",
queue,Weekly challenge results are in!,,weekly
,Idea: a thread on Peru's driving side,,`;

export function ImportForm({ slug, timeZone }: { slug: string; timeZone: string }) {
  const [state, preview, checking] = useActionState<PreviewState, FormData>(previewImport.bind(null, slug), { csv: "" });
  const [csv, setCsv] = useState(state.csv);
  const rows = state.rows ?? [];
  const ok = rows.filter((r) => r.problems.length === 0);
  // The preview is only valid for the exact text it checked.
  // (Forms submit line breaks as CRLF, so compare ignoring that.)
  const normalise = (t: string) => t.replace(/\r\n/g, "\n");
  const stale = normalise(csv) !== normalise(state.csv);

  return (
    <div className="space-y-4">
      <form action={preview} className="space-y-3">
        <textarea
          name="csv"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          placeholder={EXAMPLE}
          className="input font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-ghost cursor-pointer px-3 py-1.5 text-xs">
            Choose CSV file
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setCsv(await file.text());
              }}
            />
          </label>
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setCsv(EXAMPLE)}>
            Use the example
          </button>
          <SubmitButton className="btn-primary ml-auto" pendingText="Checking…" disabled={!csv.trim() || checking}>
            Check
          </SubmitButton>
        </div>
      </form>

      {state.error && <p className="notice-error">{state.error}</p>}

      {rows.length > 0 && (
        <section className="space-y-3">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Post</th>
                  <th className="px-3 py-2 font-medium">Accounts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={`border-b border-line align-top last:border-0 ${r.problems.length ? "bg-bad/5" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs text-subtle">{r.line}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {r.mode === "draft"
                        ? "Draft"
                        : r.at
                          ? new Date(r.at).toLocaleString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                          : "–"}
                      {r.mode === "queue" && <span className="text-subtle"> (queue)</span>}
                      {r.repeat && <div className="text-accent">🔁 {r.repeat}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="line-clamp-3 whitespace-pre-wrap">{r.text || <span className="text-subtle">(empty)</span>}</div>
                      {r.problems.map((p, i) => (
                        <div key={i} className="mt-1 text-xs text-bad">✕ {p}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{r.accountLabels.join(", ") || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={commitImport.bind(null, slug)} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="csv" value={state.csv} />
            <p className="text-sm text-muted">
              {ok.length} of {rows.length} row{rows.length === 1 ? "" : "s"} ready.
              {rows.length > ok.length && " Rows with problems are skipped; fix them and check again to include them."}
            </p>
            <SubmitButton className="btn-primary ml-auto" pendingText="Importing…" disabled={ok.length === 0 || stale}>
              {stale ? "Check again first" : `Import ${ok.length} post${ok.length === 1 ? "" : "s"}`}
            </SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}
