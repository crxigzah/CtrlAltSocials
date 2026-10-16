import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson } from "@/lib/crypto";
import type { Post, PostStatus } from "@/lib/types";

/**
 * Tells the project's alert channel (a Discord webhook) when a scheduled post didn't
 * fully go out, since nobody is watching the screen when the scheduler runs.
 * Best effort: an alert that can't be sent never affects the post itself.
 */
export async function sendFailureAlert(supabase: SupabaseClient, post: Post, status: PostStatus) {
  if (status !== "failed" && status !== "partial") return;
  try {
    const { data: ws } = await supabase.from("workspaces").select("name, slug, alert_webhook").eq("id", post.workspace_id).single();
    if (!ws?.alert_webhook) return;
    const { webhookUrl } = decryptJson<{ webhookUrl: string }>(ws.alert_webhook);

    const { data: failed } = await supabase
      .from("post_targets")
      .select("error, account:accounts(label)")
      .eq("post_id", post.id)
      .eq("status", "failed");
    const reasons = (failed ?? [])
      .map((t) => `• ${(t.account as unknown as { label: string } | null)?.label ?? "Removed account"}: ${t.error ?? "unknown error"}`)
      .slice(0, 5)
      .join("\n");
    const preview = post.body ? `> ${post.body.slice(0, 140).replace(/\n/g, " ")}${post.body.length > 140 ? "…" : ""}\n` : "";
    const link = process.env.APP_URL ? `\n${process.env.APP_URL.replace(/\/$/, "")}/w/${ws.slug}` : "";
    const headline = status === "failed" ? "A scheduled post didn't go out" : "A scheduled post only partly went out";

    await fetch(`${webhookUrl}?wait=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `⚠️ **${ws.name}**: ${headline}.\n${preview}${reasons}${link}`.slice(0, 2000),
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch (err) {
    console.error("failure alert not sent", post.id, err);
  }
}

/** Posts a message to a project's alert channel, if it has one. Best effort. */
export async function sendAlert(supabase: SupabaseClient, workspaceId: string, content: string) {
  try {
    const { data: ws } = await supabase.from("workspaces").select("alert_webhook").eq("id", workspaceId).single();
    if (!ws?.alert_webhook) return;
    const { webhookUrl } = decryptJson<{ webhookUrl: string }>(ws.alert_webhook);
    await fetch(`${webhookUrl}?wait=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch (err) {
    console.error("alert not sent", workspaceId, err);
  }
}
