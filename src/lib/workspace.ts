import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/types";

/**
 * ALLOWED_EMAILS (comma separated) limits who can use this deployment. Checked on
 * every request, not just at sign-up, because Supabase's own sign-up endpoint can be
 * called directly. Unset means anyone with a login.
 */
export function emailAllowed(email: string | undefined): boolean {
  const list = process.env.ALLOWED_EMAILS?.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !list?.length || list.includes((email ?? "").toLowerCase());
}

export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!emailAllowed(user.email)) redirect("/login?error=" + encodeURIComponent("This account isn't allowed on this CtrlAltSocials."));
  return user;
});

export type Role = "owner" | "editor";

/**
 * A project the signed-in user is a member of, with their role; 404s for anyone else's.
 * Membership is enforced by row-level security too, so this is belt and braces.
 */
export const getWorkspace = cache(async (slug: string): Promise<Workspace & { role: Role }> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("*, workspace_members!inner(role)")
    .eq("slug", slug)
    .eq("workspace_members.user_id", user.id)
    .maybeSingle<Workspace & { workspace_members: { role: Role }[] }>();
  if (!data) notFound();
  const { workspace_members, ...ws } = data;
  return { ...ws, role: workspace_members[0].role };
});

/** For the owner-only parts (accounts, brand kit, settings, members). Editors are sent back to Compose. */
export async function requireOwner(slug: string) {
  const ws = await getWorkspace(slug);
  if (ws.role !== "owner") redirect(`/w/${slug}?error=${encodeURIComponent("Only the project's owner can change that.")}`);
  return ws;
}

export function slugify(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "project";
}
