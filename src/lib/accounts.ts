import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { ConnectResult } from "@/lib/platforms/adapters/shared";

/**
 * Stores a freshly connected account. Connecting an account that's already in the
 * workspace refreshes its credentials (and clears any error) instead of adding a duplicate.
 * A label the user typed wins over the platform's default.
 */
export async function saveAccount(
  supabase: SupabaseClient,
  workspaceId: string,
  platform: string,
  result: ConnectResult<unknown>,
  customLabel?: string | null,
): Promise<{ label: string; reconnected: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from("accounts")
    .select("id, label, credentials")
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .eq("remote_id", result.remoteId)
    .maybeSingle();

  // Settings kept alongside the tokens (e.g. a Reddit account's subreddit) survive a reconnect.
  let previous: Record<string, unknown> = {};
  try {
    previous = existing?.credentials ? decryptJson<Record<string, unknown>>(existing.credentials) : {};
  } catch {
    previous = {};
  }
  const fields = {
    credentials: encryptJson({ ...previous, ...(result.credentials as Record<string, unknown>) }),
    status: "connected",
    last_error: null,
  };

  if (existing) {
    const label = customLabel || existing.label;
    const { error } = await supabase.from("accounts").update({ ...fields, label }).eq("id", existing.id);
    return { label, reconnected: true, error: error?.message };
  }
  const label = customLabel || result.label;
  const { error } = await supabase
    .from("accounts")
    .insert({ ...fields, workspace_id: workspaceId, platform, label, remote_id: result.remoteId });
  return { label, reconnected: false, error: error?.message };
}
