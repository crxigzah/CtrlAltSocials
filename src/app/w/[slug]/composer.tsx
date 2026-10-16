"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlatformIcon } from "@/components/platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { getPlatform, MAX_UPLOAD_BYTES, postLength, postProblems, UPLOAD_TYPES } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/client";
import type { Account } from "@/lib/types";
import { discardUpload } from "./actions";

type Props = {
  slug: string;
  workspaceId: string;
  accounts: Pick<Account, "id" | "platform" | "label" | "status">[];
  action: (formData: FormData) => Promise<void>;
};

type Attachment = {
  key: string;
  file: File;
  preview: string;
  alt: string;
  path: string | null;
  error: string | null;
};

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function Composer({ slug, workspaceId, accounts, action }: Props) {
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(accounts.filter((a) => a.status === "connected").map((a) => a.id)));
  const [when, setWhen] = useState<"now" | "later">("now");
  const [localTime, setLocalTime] = useState(() => localInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  // Created on first upload: the browser client only belongs in the browser.
  const supabaseRef = useRef<SupabaseClient | null>(null);

  // Free the preview URLs when the composer goes away.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach(URL.revokeObjectURL), []);

  const uploading = attachments.some((a) => !a.path && !a.error);
  const ready = attachments.filter((a) => a.path);
  const mediaInfo = ready.map((a) => ({ mime: a.file.type, size: a.file.size }));

  const checks = useMemo(
    () =>
      accounts
        .filter((a) => selected.has(a.id))
        .map((a) => {
          const platform = getPlatform(a.platform)!;
          return { account: a, platform, remaining: platform.maxLength - postLength(platform, body), problems: postProblems(platform, body, mediaInfo) };
        }),
    // mediaInfo is derived from attachments; depend on that instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, selected, body, attachments],
  );
  const blocked = checks.filter((c) => c.problems.length);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addFiles(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const key = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      const error = !UPLOAD_TYPES.includes(file.type)
        ? "Use JPG, PNG, WebP, GIF, MP4 or MOV."
        : file.size > MAX_UPLOAD_BYTES
          ? "Files must be under 50 MB."
          : null;
      setAttachments((prev) => [...prev, { key, file, preview, alt: "", path: null, error }]);
      if (error) continue;

      const path = `${workspaceId}/${key}.${EXT[file.type]}`;
      supabaseRef.current ??= createClient();
      const { error: uploadError } = await supabaseRef.current.storage.from("media").upload(path, file, { contentType: file.type, upsert: false });
      setAttachments((prev) =>
        prev.map((a) => (a.key === key ? { ...a, path: uploadError ? null : path, error: uploadError ? `Upload failed: ${uploadError.message}` : null } : a)),
      );
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function remove(a: Attachment) {
    setAttachments((prev) => prev.filter((x) => x.key !== a.key));
    if (a.path) void discardUpload(slug, a.path);
  }

  function move(index: number, by: number) {
    setAttachments((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });
  }

  const canSubmit = (body.trim() || ready.length) && selected.size > 0 && blocked.length === 0 && !uploading && !attachments.some((a) => a.error);

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

      {attachments.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {attachments.map((a, i) => (
            <li key={a.key} className="space-y-1.5">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-line bg-raised">
                {a.file.type.startsWith("video/") ? (
                  <video src={a.preview} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.preview} alt="" className="h-full w-full object-cover" />
                )}
                {!a.path && !a.error && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">Uploading…</span>
                )}
                {a.error && (
                  <span className="absolute inset-0 flex items-center justify-center bg-bad/80 p-2 text-center text-xs text-white">{a.error}</span>
                )}
                <div className="absolute right-1 top-1 flex gap-1">
                  {i > 0 && <IconButton label="Move earlier" onClick={() => move(i, -1)}>←</IconButton>}
                  {i < attachments.length - 1 && <IconButton label="Move later" onClick={() => move(i, 1)}>→</IconButton>}
                  <IconButton label="Remove" onClick={() => remove(a)}>✕</IconButton>
                </div>
              </div>
              <input
                value={a.alt}
                onChange={(e) => setAttachments((prev) => prev.map((x) => (x.key === a.key ? { ...x, alt: e.target.value } : x)))}
                maxLength={1000}
                placeholder="Alt text"
                className="input px-2 py-1 text-xs"
              />
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name="media" value={JSON.stringify(ready.map((a) => ({ path: a.path, alt: a.alt })))} />

      <div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={UPLOAD_TYPES.join(",")}
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => fileInput.current?.click()}>
          + Image or video
        </button>
      </div>

      <div>
        <div className="field-label">Post to</div>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const on = selected.has(a.id);
            const check = checks.find((c) => c.account.id === a.id);
            const bad = check && check.problems.length > 0;
            return (
              <label
                key={a.id}
                title={bad ? check.problems.join(", ") : undefined}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition ${
                  on ? (bad ? "border-bad bg-bad/10" : "border-accent bg-accent/10") : "border-line opacity-60 hover:opacity-100"
                }`}
              >
                <input type="checkbox" name="account_ids" value={a.id} checked={on} onChange={() => toggle(a.id)} className="sr-only" />
                <PlatformIcon platform={a.platform} size={20} />
                <span>{a.label}</span>
                {on && check && (
                  <span className={`font-mono text-xs ${check.remaining < 0 ? "text-bad" : "text-subtle"}`}>{check.remaining}</span>
                )}
                {a.status === "error" && <span className="badge bg-warn/15 text-warn">check</span>}
              </label>
            );
          })}
        </div>
      </div>

      {blocked.length > 0 && (
        <ul className="notice-error space-y-0.5">
          {blocked.map((c) => (
            <li key={c.account.id}>
              <span className="font-medium">{c.account.label}</span> ({c.platform.name}): {c.problems.join(", ")}
            </li>
          ))}
          <li className="text-xs opacity-80">Fix these or untick those accounts.</li>
        </ul>
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
            <input type="datetime-local" value={localTime} onChange={(e) => setLocalTime(e.target.value)} className="input w-auto" required />
            {/* The browser knows the user's timezone; the server gets an unambiguous UTC time. */}
            <input type="hidden" name="scheduled_at" value={localTime ? new Date(localTime).toISOString() : ""} />
          </>
        )}
        <SubmitButton
          className="btn-primary ml-auto"
          pendingText={when === "now" ? "Posting…" : "Scheduling…"}
          disabled={!canSubmit}
        >
          {uploading ? "Uploading…" : when === "now" ? `Post to ${selected.size}` : `Schedule for ${selected.size}`}
        </SubmitButton>
      </div>
    </form>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded bg-black/70 text-xs text-white hover:bg-black"
    >
      {children}
    </button>
  );
}
