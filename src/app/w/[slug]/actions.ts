"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { encryptJson } from "@/lib/crypto";
import { describeError, getAdapter } from "@/lib/platforms/adapters";
import { getPlatform, postLength } from "@/lib/platforms/catalog";
import { publishPost } from "@/lib/publisher";
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
  if (!adapter) back(path, { error: "That platform can't be connected yet." });

  let saved: { credentials: string; label: string };
  try {
    const { credentials, label } = await adapter!.connect(formData);
    saved = { credentials: encryptJson(credentials), label: optional(formData.get("label")) ?? label };
  } catch (err) {
    return back(path, { error: describeError(err), platform });
  }
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").insert({ workspace_id: ws.id, platform, ...saved, status: "connected" });
  if (error) back(path, { error: error.message });
  revalidatePath(`/w/${slug}`, "layout");
  back(path, { connected: saved.label });
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

  if (!body) back(path, { error: "Write something first." });
  if (accountIds.length === 0) back(path, { error: "Pick at least one account to post to." });

  let scheduledAt = new Date();
  if (when === "later") {
    scheduledAt = new Date(scheduledRaw);
    if (Number.isNaN(scheduledAt.getTime())) back(path, { error: "Pick a date and time to schedule for." });
    if (scheduledAt.getTime() < Date.now() - 60_000) back(path, { error: "That time has already passed." });
  }

  const supabase = await createClient();
  // Only this workspace's accounts can be targeted, whatever the form sent.
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, platform, label")
    .eq("workspace_id", ws.id)
    .in("id", accountIds);
  if (!accounts || accounts.length !== accountIds.length) back(path, { error: "One of those accounts isn't in this project." });

  for (const a of accounts!) {
    const platform = getPlatform(a.platform)!;
    if (postLength(platform, body) > platform.maxLength) {
      back(path, { error: `Too long for ${a.label} on ${platform.name} (max ${platform.maxLength}).` });
    }
  }

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ workspace_id: ws.id, body, scheduled_at: scheduledAt.toISOString(), status: when === "now" ? "publishing" : "scheduled" })
    .select()
    .single<Post>();
  if (error || !post) return back(path, { error: error?.message ?? "Couldn't save the post." });

  const { error: targetError } = await supabase
    .from("post_targets")
    .insert(accounts!.map((a) => ({ post_id: post.id, account_id: a.id })));
  if (targetError) {
    await supabase.from("posts").delete().eq("id", post.id);
    back(path, { error: targetError.message });
  }

  if (when === "now") {
    const status = await publishPost(supabase, post);
    revalidatePath(path);
    back(path, { posted: status });
  }
  revalidatePath(path);
  back(path, { scheduled: "1" });
}

export async function cancelPost(slug: string, postId: string) {
  const ws = await getWorkspace(slug);
  const supabase = await createClient();
  // Only posts that haven't started sending can be cancelled.
  await supabase.from("posts").delete().eq("id", postId).eq("workspace_id", ws.id).eq("status", "scheduled");
  revalidatePath(`/w/${slug}`);
}
