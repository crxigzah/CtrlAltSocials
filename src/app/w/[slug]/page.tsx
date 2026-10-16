import Link from "next/link";
import { PlatformIcon } from "@/components/platform-icon";
import { LIVE_PLATFORMS } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";
import type { Account, Post, PostTarget } from "@/lib/types";
import { aiEnabled } from "@/lib/tailor";
import { getWorkspace } from "@/lib/workspace";
import { cancelPost, createPost, retryFailed } from "./actions";
import { Composer, type Draft } from "./composer";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Compose" };
// "Post now" publishes inside the server action, and Threads/Instagram video can take a while to process.
export const maxDuration = 60;

type PostRow = Post & { post_media: { id: string; mime: string; alt: string | null; position: number }[]; post_targets: (PostTarget & { account: Pick<Account, "label" | "platform"> | null })[] };

const POST_STATUS: Record<Post["status"], { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-accent/15 text-accent" },
  publishing: { label: "Sending", cls: "bg-warn/15 text-warn" },
  done: { label: "Posted", cls: "bg-ok/15 text-ok" },
  partial: { label: "Partly posted", cls: "bg-warn/15 text-warn" },
  failed: { label: "Failed", cls: "bg-bad/15 text-bad" },
};

export default async function ComposePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; posted?: string; scheduled?: string; edit?: string; duplicate?: string }>;
}) {
  const { slug } = await params;
  const { error, posted, scheduled, edit, duplicate } = await searchParams;
  const ws = await getWorkspace(slug);
  const supabase = await createClient();

  const live = LIVE_PLATFORMS.map((p) => p.id);
  const [{ data: accounts }, { data: posts }] = await Promise.all([
    supabase.from("accounts").select("id, platform, label, status").eq("workspace_id", ws.id).in("platform", live).order("created_at"),
    supabase
      .from("posts")
      .select("*, post_media(id, mime, alt, position), post_targets(*, account:accounts(label, platform))")
      .eq("workspace_id", ws.id)
      .order("scheduled_at", { ascending: false })
      .limit(50)
      .returns<PostRow[]>(),
  ]);

  const draft = await loadDraft(supabase, ws.id, edit ?? duplicate, Boolean(edit));
  const upcoming = (posts ?? []).filter((p) => p.status === "scheduled").reverse();
  const history = (posts ?? []).filter((p) => p.status !== "scheduled");

  return (
    <div className="space-y-8">
      {error && <p className="notice-error">{error}</p>}
      {posted === "done" && <p className="notice-ok">Posted to every account.</p>}
      {posted === "partial" && <p className="notice-error">Posted to some accounts but not all. See the details below.</p>}
      {posted === "failed" && <p className="notice-error">The post didn&apos;t go out. See the details below.</p>}
      {scheduled === "1" && <p className="notice-ok">Scheduled.</p>}
      {scheduled === "updated" && <p className="notice-ok">Changes saved.</p>}
      {edit && !draft && <p className="notice-error">That post has already gone out or been cancelled, so it can&apos;t be edited.</p>}
      {draft && (
        <p className="flex items-center gap-3 text-sm text-muted">
          {draft.postId ? "Editing a scheduled post." : "Copied from an earlier post. Change anything you like, then post or schedule it."}
          <Link href={`/w/${slug}`} className="link">{draft.postId ? "Stop editing" : "Start fresh"}</Link>
        </p>
      )}

      {(accounts ?? []).length === 0 ? (
        <div className="card text-center">
          <p className="font-medium">No accounts connected to {ws.name} yet.</p>
          <p className="mt-1 text-sm text-muted">Connect one and it&apos;ll show up here to post to.</p>
          <Link href={`/w/${slug}/accounts`} className="btn-primary mt-4">Connect an account</Link>
        </div>
      ) : (
        <Composer
          key={draft ? `${draft.postId ?? "copy"}-${edit ?? duplicate}` : "new"}
          draft={draft ?? undefined}
          aiEnabled={aiEnabled()}
          slug={slug}
          workspaceId={ws.id}
          accounts={accounts as Pick<Account, "id" | "platform" | "label" | "status">[]}
          action={createPost.bind(null, slug)}
        />
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Queue</h2>
          {upcoming.map((p) => (
            <PostCard key={p.id} post={p}>
              <span className="flex items-center gap-3">
                <Link href={`/w/${slug}?edit=${p.id}`} className="text-xs text-accent hover:underline">Edit</Link>
                <form action={cancelPost.bind(null, slug, p.id)}>
                  <button className="text-xs text-muted hover:text-bad">Cancel</button>
                </form>
              </span>
            </PostCard>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">History</h2>
        {history.length === 0 && <p className="text-sm text-subtle">Nothing posted yet.</p>}
        {history.map((p) => (
          <PostCard key={p.id} post={p}>
            <span className="flex items-center gap-3">
              {(p.status === "failed" || p.status === "partial") && (
                <form action={retryFailed.bind(null, slug, p.id)}>
                  <button className="text-xs text-accent hover:underline">Retry failed</button>
                </form>
              )}
              <Link href={`/w/${slug}?duplicate=${p.id}`} className="text-xs text-muted hover:text-fg">Post again</Link>
            </span>
          </PostCard>
        ))}
      </section>
    </div>
  );
}

function PostCard({ post, children }: { post: PostRow; children?: React.ReactNode }) {
  const s = POST_STATUS[post.status];
  return (
    <article className="card space-y-3 p-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={`badge ${s.cls}`}>{s.label}</span>
        <LocalTime iso={post.scheduled_at} />
        <span className="ml-auto">{children}</span>
      </div>
      {post.body && <p className="whitespace-pre-wrap text-sm">{post.body}</p>}
      {post.post_media.length > 0 && (
        <p className="text-xs text-muted">
          📎 {post.post_media.length} attachment{post.post_media.length === 1 ? "" : "s"}
          {" "}({[...new Set(post.post_media.map((m) => (m.mime.startsWith("video/") ? "video" : "image")))].join(" + ")})
        </p>
      )}
      <ul className="flex flex-wrap gap-2">
        {post.post_targets.map((t) => (
          <li key={t.id} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs" title={t.error ?? undefined}>
            {t.account && <PlatformIcon platform={t.account.platform} size={16} />}
            <span>{t.account?.label ?? "Removed account"}</span>
            {t.status === "sent" && (t.remote_url ? <a href={t.remote_url} target="_blank" rel="noreferrer" className="link">view</a> : <span className="text-ok">sent</span>)}
            {t.status === "failed" && <span className="text-bad">failed</span>}
          </li>
        ))}
      </ul>
      {post.post_targets.filter((t) => t.body !== null).map((t) => (
        <p key={`b-${t.id}`} className="whitespace-pre-wrap border-l-2 border-line pl-2 text-xs text-muted">
          <span className="text-subtle">{t.account?.label}:</span> {t.body}
        </p>
      ))}
      {post.post_targets.filter((t) => t.error).map((t) => (
        // On a sent post the "error" is a note (e.g. posted as private), so it's a warning, not a failure.
        <p key={t.id} className={`text-xs ${t.status === "sent" ? "text-warn" : "text-bad"}`}>{t.account?.label}: {t.error}</p>
      ))}
    </article>
  );
}

/** Loads a post into the composer: as itself when editing (only while scheduled), or as a fresh copy. */
async function loadDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  postId: string | undefined,
  editing: boolean,
): Promise<Draft | null> {
  if (!postId) return null;
  let query = supabase
    .from("posts")
    .select("id, body, scheduled_at, status, post_media(path, alt, mime, size, position), post_targets(account_id, body)")
    .eq("id", postId)
    .eq("workspace_id", workspaceId);
  if (editing) query = query.eq("status", "scheduled");
  const { data } = await query.maybeSingle();
  if (!data) return null;

  const media = [...(data.post_media as { path: string; alt: string | null; mime: string; size: number; position: number }[])].sort(
    (a, b) => a.position - b.position,
  );
  const { data: signed } = media.length
    ? await supabase.storage.from("media").createSignedUrls(media.map((m) => m.path), 60 * 60)
    : { data: [] };
  const targets = data.post_targets as { account_id: string; body: string | null }[];
  return {
    postId: editing ? data.id : null,
    body: data.body,
    accountIds: targets.map((t) => t.account_id),
    overrides: Object.fromEntries(targets.filter((t) => t.body !== null).map((t) => [t.account_id, t.body!])),
    media: media.map((m, i) => ({ ...m, preview: signed?.[i]?.signedUrl ?? "" })),
    scheduledAt: data.scheduled_at,
  };
}
