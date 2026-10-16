import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { describeError, getAdapter } from "@/lib/platforms/adapters";
import { getPlatform, postLength } from "@/lib/platforms/catalog";
import type { Post, PostStatus } from "@/lib/types";

type TargetRow = {
  id: string;
  status: "pending" | "sent" | "failed";
  account: { id: string; platform: string; credentials: string | null; status: string } | null;
};

/**
 * Sends a claimed post (status "publishing") to each of its pending targets, records
 * every result, and settles the post's status. Targets already sent are never resent.
 */
export async function publishPost(supabase: SupabaseClient, post: Post): Promise<PostStatus> {
  const { data, error } = await supabase
    .from("post_targets")
    .select("id, status, account:accounts(id, platform, credentials, status)")
    .eq("post_id", post.id)
    .returns<TargetRow[]>();
  if (error) throw error;

  const targets = data ?? [];
  for (const target of targets.filter((t) => t.status === "pending")) {
    const { accountError, newCredentials, ...update } = await sendOne(target, post.body);
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

async function sendOne(target: TargetRow, body: string) {
  const fail = (error: string, accountError = false, newCredentials?: unknown) =>
    ({ status: "failed" as const, error, sent_at: null, remote_url: null, accountError, newCredentials });

  const account = target.account;
  if (!account || !account.credentials) return fail("This account was removed or never finished connecting.");
  const platform = getPlatform(account.platform);
  const adapter = getAdapter(account.platform);
  if (!platform || !adapter) return fail(`Posting to ${platform?.name ?? account.platform} isn't supported yet.`);
  if (postLength(platform, body) > platform.maxLength) {
    return fail(`Too long for ${platform.name} (max ${platform.maxLength} characters).`);
  }

  try {
    const result = await adapter.publish(decryptJson(account.credentials), body);
    return {
      status: "sent" as const,
      error: null,
      sent_at: new Date().toISOString(),
      remote_url: result.url,
      accountError: false,
      newCredentials: result.credentials,
    };
  } catch (err) {
    return fail(describeError(err), true, (err as { credentials?: unknown }).credentials);
  }
}
