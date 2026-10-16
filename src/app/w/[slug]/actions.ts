"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveAccount } from "@/lib/accounts";
import { describeError, getAdapter } from "@/lib/platforms/adapters";
import { decryptJson } from "@/lib/crypto";
import type { ConnectResult, FormAdapter } from "@/lib/platforms/adapters/shared";
import { getPlatform, postProblems, UPLOAD_TYPES, type MediaInfo } from "@/lib/platforms/catalog";
import { publishPost, retryPost } from "@/lib/publisher";
import { createClient } from "@/lib/supabase/server";
import type { Post } from "@/lib/types";
import { getWorkspace } from "@/lib/workspace";

const back = (path: string, params: Record<string, string>) => redirect(`${path}?${new URLSearchParams(params)}`);
const optional = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

// --- Brand kit ---------------------------------------------------------------

export async function updateBrandKit(slug: string, formData: FormData) {
  const ws = await getWorkspace(slug);
  const path = `/w/${slug}/settings`;
  const handle = optional(formData.get("handle"))?.replace(/^@/, "") ?? null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      name: String(formData.get("name") ?? ws.name).trim() || ws.name,
      color: String(formData.get("color") || ws.color),
      handle,
      bio: optional(formData.get("bio")),
      website: optional(formData.get("website")),
      signup_email: optional(formData.get("signup_email")),
      avatar_url: optional(formData.get("avatar_url")),
    })
    .eq("id", ws.id);
  if (error) back(path, { error: error.message.includes("handle") ? "Handles can only use letters, numbers, _ and . (max 30)." : error.message });
  revalidatePath(`/w/${slug}`, "layout");
  back(path, { saved: "1" });
}

export async function deleteWorkspace(slug: string, formData: FormData) {
  const ws = await getWorkspace(slug);
  if (String(formData.get("confirm") ?? "") !== ws.name) {
    back(`/w/${slug}/settings`, { error: `Type "${ws.name}" to confirm deleting the project.` });
  }
  const supabase = await createClient();
  // Uploaded files aren't covered by the cascade; clear the project's folder first.
  for (let round = 0; round < 20; round++) {
    const { data: files } = await supabase.storage.from("media").list(ws.id, { limit: 1000 });
    if (!files?.length) break;
    await supabase.storage.from("media").remove(files.map((f) => `${ws.id}/${f.name}`));
  }
  await supabase.from("workspaces").delete().eq("id", ws.id);
  redirect("/");
}

// --- Setup checklist ---------------------------------------------------------

export async function toggleSetup(slug: string, platform: string, done: boolean) {
  const ws = await getWorkspace(slug);
  if (!getPlatform(platform)) return;
  const supabase = await createClient();
  if (done) await supabase.from("setup_progress").upsert({ workspace_id: ws.id, platform });
  else await supabase.from("setup_progress").delete().eq("workspace_id", ws.id).eq("platform", platform);
  revalidatePath(`/w/${slug}/setup`);
}

// --- Accounts ----------------------------------------------------------------

export async function connectAccount(slug: string, formData: FormData) {
  const ws = await getWorkspace(slug);
  const path = `/w/${slug}/accounts`;
  const platform = String(formData.get("platform") ?? "");
  const adapter = getAdapter(platform);
  if (adapter?.kind !== "form") back(path, { error: "That platform can't be connected with a form." });

  let result;
  try {
    result = await (adapter as FormAdapter<unknown>).connect(formData);
  } catch (err) {
    return back(path, { error: describeError(err), platform });
  }
  const supabase = await createClient();
  const saved = await saveAccount(supabase, ws.id, platform, result, optional(formData.get("label")));
  if (saved.error) back(path, { error: saved.error });
  revalidatePath(`/w/${slug}`, "layout");
  back(path, { [saved.reconnected ? "reconnected" : "connected"]: saved.label });
}

export async function pickConnection(slug: string, pendingId: string, index: number) {
  const ws = await getWorkspace(slug);
  const path = `/w/${slug}/accounts`;
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("pending_connections")
    .select("platform, choices, expires_at")
    .eq("id", pendingId)
    .eq("workspace_id", ws.id)
    .maybeSingle();
  if (!pending || new Date(pending.expires_at) < new Date()) back(path, { error: "That choice expired. Connect the account again." });

  const choice = decryptJson<ConnectResult<unknown>[]>(pending!.choices)[index];
  await supabase.from("pending_connections").delete().eq("workspace_id", ws.id);
  if (!choice) back(path, { error: "That option wasn't in the list." });
  const saved = await saveAccount(supabase, ws.id, pending!.platform, choice);
  if (saved.error) back(path, { error: saved.error });
  revalidatePath(`/w/${slug}`, "layout");
  back(path, { [saved.reconnected ? "reconnected" : "connected"]: saved.label });
}

export async function removeAccount(slug: string, accountId: string) {
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  await supabase.from("accounts").delete().eq("id", accountId).eq("workspace_id", ws.id);
  revalidatePath(`/w/${slug}`, "layout");
}

// --- Posts -------------------------------------------------------------------

export async function createPost(slug: string, formData: FormData) {
  const ws = await getWorkspace(slug);
  const path = `/w/${slug}`;
  const body = String(formData.get("body") ?? "").trim();
  const accountIds = formData.getAll("account_ids").map(String);
  const when = String(formData.get("when") ?? "now");
  const scheduledRaw = String(formData.get("scheduled_at") ?? "");

  if (accountIds.length === 0) back(path, { error: "Pick at least one account to post to." });

  let scheduledAt = new Date();
  if (when === "later") {
    scheduledAt = new Date(scheduledRaw);
    if (Number.isNaN(scheduledAt.getTime())) back(path, { error: "Pick a date and time to schedule for." });
    if (scheduledAt.getTime() < Date.now() - 60_000) back(path, { error: "That time has already passed." });
  }

  const supabase = await createClient();
  const media = await verifyMedia(supabase, ws.id, String(formData.get("media") ?? "[]"));
  if (typeof media === "string") return back(path, { error: media });
  // Per-account wording, only kept when it actually differs from the main text.
  const overrides = new Map<string, string>();
  for (const id of accountIds) {
    const text = formData.get(`override_${id}`);
    if (text !== null && String(text).trim() !== body) overrides.set(id, String(text).trim());
  }
  if (!body && media.length === 0 && overrides.size === 0) back(path, { error: "Write something or attach a file first." });

  // Only this workspace's accounts can be targeted, whatever the form sent.
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, platform, label")
    .eq("workspace_id", ws.id)
    .in("id", accountIds);
  if (!accounts || accounts.length !== accountIds.length) back(path, { error: "One of those accounts isn't in this project." });

  for (const a of accounts!) {
    const platform = getPlatform(a.platform)!;
    const problems = postProblems(platform, overrides.get(a.id) ?? body, media);
    if (problems.length) back(path, { error: `${a.label} (${platform.name}): ${problems.join(", ")}.` });
  }

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      workspace_id: ws.id,
      body,
      scheduled_at: scheduledAt.toISOString(),
      status: when === "now" ? "publishing" : "scheduled",
      claimed_at: when === "now" ? new Date().toISOString() : null,
    })
    .select()
    .single<Post>();
  if (error || !post) return back(path, { error: error?.message ?? "Couldn't save the post." });

  const { error: targetError } = await supabase
    .from("post_targets")
    .insert(accounts!.map((a) => ({ post_id: post.id, account_id: a.id, body: overrides.get(a.id) ?? null })));
  const { error: mediaError } = media.length
    ? await supabase.from("post_media").insert(media.map((m, position) => ({ post_id: post.id, position, path: m.path, mime: m.mime, size: m.size, alt: m.alt })))
    : { error: null };
  if (targetError || mediaError) {
    await supabase.from("posts").delete().eq("id", post.id);
    back(path, { error: (targetError ?? mediaError)!.message });
  }

  if (when === "now") {
    const status = await publishPost(supabase, post);
    revalidatePath(path);
    back(path, { posted: status });
  }
  revalidatePath(path);
  back(path, { scheduled: "1" });
}

export async function retryFailed(slug: string, postId: string) {
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  const { data: owned } = await supabase.from("posts").select("id").eq("id", postId).eq("workspace_id", ws.id).maybeSingle();
  if (!owned) back(`/w/${slug}`, { error: "That post isn't in this project." });
  const status = await retryPost(supabase, postId);
  revalidatePath(`/w/${slug}`);
  back(`/w/${slug}`, status ? { posted: status } : { error: "That post is already sending or has nothing left to retry." });
}

export async function cancelPost(slug: string, postId: string) {
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  // Only posts that haven't started sending can be cancelled.
  const { data: deleted } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("workspace_id", ws.id)
    .eq("status", "scheduled")
    .select("post_media(path)");
  const paths = (deleted ?? []).flatMap((p) => (p.post_media as { path: string }[]).map((m) => m.path));
  if (paths.length) await supabase.storage.from("media").remove(paths);
  revalidatePath(`/w/${slug}`);
}

/** Removes a file uploaded in the composer but taken off the post before it was sent. */
export async function discardUpload(slug: string, path: string) {
  const ws = await getWorkspace(slug);
  if (!MEDIA_PATH.test(path) || !path.startsWith(`${ws.id}/`)) return;
  const supabase = await createClient();
  const { count } = await supabase.from("post_media").select("id", { count: "exact", head: true }).eq("path", path);
  if (!count) await supabase.storage.from("media").remove([path]);
}

const MEDIA_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|mov)$/;

type VerifiedMedia = MediaInfo & { path: string; alt: string | null };

/**
 * The composer uploads straight to Storage and sends back paths. Trust nothing about
 * them: each must be in this workspace's folder and exist, and its real size and type
 * come from Storage, not the browser.
 */
async function verifyMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  raw: string,
): Promise<VerifiedMedia[] | string> {
  let items: { path?: unknown; alt?: unknown }[];
  try {
    items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error();
  } catch {
    return "The attachments didn't come through. Try attaching them again.";
  }
  if (items.length > 20) return "That's more attachments than any platform allows.";

  const out: VerifiedMedia[] = [];
  for (const item of items) {
    const path = String(item.path ?? "");
    if (!MEDIA_PATH.test(path) || !path.startsWith(`${workspaceId}/`)) return "One of the attachments isn't from this project.";
    const { data, error } = await supabase.storage.from("media").info(path);
    if (error || !data) return "One of the attachments is missing. Remove it and attach it again.";
    // Depending on the Storage version, type and size come top-level or inside metadata.
    const meta = (data.metadata ?? {}) as { mimetype?: string; size?: number; contentLength?: number };
    const mime = data.contentType ?? meta.mimetype ?? "";
    const size = data.size ?? meta.size ?? meta.contentLength ?? 0;
    if (!UPLOAD_TYPES.includes(mime) || !size) return `Unsupported file type: ${mime || "unknown"}.`;
    const alt = String(item.alt ?? "").trim().slice(0, 1000) || null;
    out.push({ path, mime, size, alt });
  }
  return out;
}
