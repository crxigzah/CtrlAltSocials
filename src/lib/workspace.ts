import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/types";

export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
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
