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

/** The signed-in user's workspace with this slug; 404s for anyone else's. */
export const getWorkspace = cache(async (slug: string): Promise<Workspace> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", user.id)
    .eq("slug", slug)
    .maybeSingle<Workspace>();
  if (!data) notFound();
  return data;
});

export function slugify(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "project";
}
