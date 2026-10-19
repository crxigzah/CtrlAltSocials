"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { encryptJson } from "@/lib/crypto";
import { describeError } from "@/lib/platforms/adapters";
import { parseWebhook } from "@/lib/platforms/adapters/discord";
import { isValidTimeZone } from "@/lib/slots";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/workspace";

const back = (slug: string, params: Record<string, string>) => redirect(`/w/${slug}/preferences?${new URLSearchParams(params)}`);

export async function setTimezone(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!isValidTimeZone(timezone)) back(slug, { error: `"${timezone}" isn't a timezone name, e.g. Europe/London.` });
  const supabase = await createClient();
  await supabase.from("workspaces").update({ timezone }).eq("id", ws.id);
  revalidatePath(`/w/${slug}`, "layout");
  back(slug, { saved: "Timezone saved." });
}

export async function addSlots(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const days = formData.getAll("weekday").map(Number).filter((d) => d >= 1 && d <= 7);
  const [h, m] = String(formData.get("time") ?? "").split(":").map(Number);
  if (!days.length) back(slug, { error: "Tick at least one day." });
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) back(slug, { error: "Pick a time." });
  const supabase = await createClient();
  await supabase
    .from("posting_slots")
    .upsert(days.map((weekday) => ({ workspace_id: ws.id, weekday, minute_of_day: h * 60 + m })), { onConflict: "workspace_id,weekday,minute_of_day", ignoreDuplicates: true });
  revalidatePath(`/w/${slug}`, "layout");
  back(slug, { saved: "Slots added." });
}

export async function removeSlot(slug: string, slotId: string) {
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  await supabase.from("posting_slots").delete().eq("id", slotId).eq("workspace_id", ws.id);
  revalidatePath(`/w/${slug}`, "layout");
}

export async function setAlertWebhook(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const raw = String(formData.get("webhook_url") ?? "").trim();
  const supabase = await createClient();
  if (!raw) {
    await supabase.from("workspaces").update({ alert_webhook: null }).eq("id", ws.id);
    back(slug, { saved: "Alerts turned off." });
  }
  let webhookUrl: string;
  try {
    webhookUrl = parseWebhook(raw);
  } catch (err) {
    return back(slug, { error: describeError(err) });
  }
  // Send a test message so a typo shows up now rather than on the night a post fails.
  let problem: string | null = null;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `✅ CtrlAltSocials will post here if a scheduled **${ws.name}** post fails.`, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) problem = `Discord didn't accept that webhook (${res.status}).`;
  } catch (err) {
    problem = describeError(err);
  }
  if (problem) back(slug, { error: problem });
  await supabase.from("workspaces").update({ alert_webhook: encryptJson({ webhookUrl }) }).eq("id", ws.id);
  back(slug, { saved: "Alerts on. A test message was sent to the channel." });
}

export async function setLinkTracking(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const enabled = formData.get("utm_enabled") === "on";
  if (enabled && !ws.website) back(slug, { error: "Add the project's website on the Brand kit tab first; only links to it get tagged." });
  const campaign = String(formData.get("utm_campaign") ?? "").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || null;
  const supabase = await createClient();
  await supabase.from("workspaces").update({ utm_enabled: enabled, utm_campaign: campaign }).eq("id", ws.id);
  revalidatePath(`/w/${slug}`, "layout");
  back(slug, { saved: enabled ? "Link tracking on." : "Link tracking off." });
}

export async function addSnippet(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!name || !body) back(slug, { error: "Give the snippet a name and some text." });
  const supabase = await createClient();
  const { error } = await supabase.from("snippets").insert({ workspace_id: ws.id, name, body });
  if (error) back(slug, { error: error.message });
  revalidatePath(`/w/${slug}`, "layout");
  back(slug, { saved: `Snippet "${name}" saved.` });
}

export async function removeSnippet(slug: string, snippetId: string) {
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  await supabase.from("snippets").delete().eq("id", snippetId).eq("workspace_id", ws.id);
  revalidatePath(`/w/${slug}`, "layout");
}

export async function setWeeklySummary(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const on = formData.get("weekly_summary") === "on";
  const supabase = await createClient();
  await supabase.from("workspaces").update({ weekly_summary: on }).eq("id", ws.id);
  back(slug, { saved: on ? "Weekly summary on." : "Weekly summary off." });
}

export async function setRequireApproval(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const on = formData.get("require_approval") === "on";
  const supabase = await createClient();
  await supabase.from("workspaces").update({ require_approval: on }).eq("id", ws.id);
  revalidatePath(`/w/${slug}`, "layout");
  back(slug, { saved: on ? "Editors' posts now need your approval." : "Editors can now schedule without approval." });
}

// --- Members ---------------------------------------------------------------------

/** Makes a single-use invite link (valid 7 days). The secret is shown once; only its hash is stored. */
export async function createInvite(slug: string, formData: FormData) {
  const ws = await requireOwner(slug);
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back(slug, { error: "That email address doesn't look right." });
  const token = randomBytes(24).toString("base64url");
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_invites")
    .insert({ workspace_id: ws.id, token_hash: createHash("sha256").update(token).digest("hex"), email });
  if (error) back(slug, { error: error.message });
  revalidatePath(`/w/${slug}/preferences`);
  back(slug, { invite: token });
}

export async function revokeInvite(slug: string, inviteId: string) {
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  await supabase.from("workspace_invites").delete().eq("id", inviteId).eq("workspace_id", ws.id);
  revalidatePath(`/w/${slug}/preferences`);
  // Redirecting also clears a just-created invite link out of the address bar.
  back(slug, { saved: "Invite cancelled." });
}

export async function removeMember(slug: string, userId: string) {
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  // RLS refuses to remove the owner row, whatever is sent.
  await supabase.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", userId).neq("role", "owner");
  revalidatePath(`/w/${slug}`, "layout");
  back(slug, { saved: "Member removed." });
}
