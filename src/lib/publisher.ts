import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { describeError, getAdapter, isNetworkError } from "@/lib/platforms/adapters";
import type { MediaFile } from "@/lib/platforms/adapters/shared";
import { getPlatform, postProblems } from "@/lib/platforms/catalog";
import type { Post, PostStatus } from "@/lib/types";

type TargetRow = {
  id: string;
  body: string | null;
  status: "pending" | "sent" | "failed";
  account: { id: string; platform: string; credentials: string | null; status: string } | null;
};

/**
 * Sends a claimed post (status "publishing") to each of its pending targets, records
 * every result, and settles the post's status. Targets already sent are never resent.
 */
/**
 * Puts a post's failed targets back in the queue and sends them again. Accounts that
 * already got the post are left alone. Returns null if the post isn't retryable.
 */
export async function retryPost(supabase: SupabaseClient, postId: string): Promise<PostStatus | null> {
  const { data: post } = await supabase
    .from("posts")
    .update({ status: "publishing", claimed_at: new Date().toISOString() })
    .eq("id", postId)
    .in("status", ["failed", "partial"])
    .select()
    .maybeSingle<Post>();
  if (!post) return null;
  await supabase.from("post_targets").update({ status: "pending", error: null }).eq("post_id", postId).eq("status", "failed");
  return publishPost(supabase, post);
}

export async function publishPost(supabase: SupabaseClient, post: Post): Promise<PostStatus> {
  const { data, error } = await supabase
    .from("post_targets")
    .select("id, status, body, account:accounts(id, platform, credentials, status)")
    .eq("post_id", post.id)
    .returns<TargetRow[]>();
  if (error) throw error;

  const targets = data ?? [];
  const media = await loadMedia(supabase, post.id);
  for (const target of targets.filter((t) => t.status === "pending")) {
    const { accountError, newCredentials, ...update } = await sendOne(target, target.body ?? post.body, media);
    await supabase.from("post_targets").update(update).eq("id", target.id);
    if (newCredentials !== undefined && target.account) {
      // A token was refreshed on the way; losing it would lock the account out.
      await supabase.from("accounts").update({ credentials: encryptJson(newCredentials) }).eq("id", target.account.id);
    }
    target.status = update.status;
    if (accountError && target.account) {
      await supabase.from("accounts").update({ status: "error", last_error: update.error }).eq("id", target.account.id);
    } else if (update.status === "sent" && target.account?.status === "error") {
      await supabase.from("accounts").update({ status: "connected", last_error: null }).eq("id", target.account.id);
    }
  }

  const sent = targets.filter((t) => t.status === "sent").length;
  const status: PostStatus = targets.length === 0 || sent === 0 ? "failed" : sent === targets.length ? "done" : "partial";
  await supabase.from("posts").update({ status }).eq("id", post.id);
  return status;
}

/** The post's attachments, each with a signed URL good for an hour and lazily fetched bytes. */
async function loadMedia(supabase: SupabaseClient, postId: string): Promise<MediaFile[]> {
  const { data, error } = await supabase
    .from("post_media")
    .select("path, mime, size, alt")
    .eq("post_id", postId)
    .order("position");
  if (error) throw error;

  const files: MediaFile[] = [];
  for (const row of data ?? []) {
    const { data: signed, error: signError } = await supabase.storage.from("media").createSignedUrl(row.path, 60 * 60);
    if (signError || !signed) throw new Error(`Couldn't read attachment ${row.path}: ${signError?.message}`);
    let cached: Promise<Buffer> | null = null;
    files.push({
      mime: row.mime,
      size: row.size,
      alt: row.alt,
      url: signed.signedUrl,
      filename: row.path.split("/").pop() ?? "file",
      bytes: () =>
        (cached ??= fetch(signed.signedUrl, { cache: "no-store" }).then(async (res) => {
          if (!res.ok) throw new Error(`Couldn't download attachment (${res.status}).`);
          return Buffer.from(await res.arrayBuffer());
        })),
    });
  }
  return files;
}

async function sendOne(target: TargetRow, body: string, media: MediaFile[]) {
  const fail = (error: string, accountError = false, newCredentials?: unknown) =>
    ({ status: "failed" as const, error, sent_at: null, remote_url: null, accountError, newCredentials });

  const account = target.account;
  if (!account || !account.credentials) return fail("This account was removed or never finished connecting.");
  const platform = getPlatform(account.platform);
  const adapter = getAdapter(account.platform);
  if (!platform || !adapter) return fail(`Posting to ${platform?.name ?? account.platform} isn't supported yet.`);
  const problems = postProblems(platform, body, media);
  if (problems.length) return fail(`Can't post this to ${platform.name}: ${problems.join(", ")}.`);

  try {
    const result = await adapter.publish(decryptJson(account.credentials), body, media);
    return {
      status: "sent" as const,
      error: null,
      sent_at: new Date().toISOString(),
      remote_url: result.url,
      accountError: false,
      newCredentials: result.credentials,
    };
  } catch (err) {
    // A network blip says nothing about the account itself, so don't flag it.
    return fail(describeError(err), !isNetworkError(err), (err as { credentials?: unknown }).credentials);
  }
}
