"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, slugify } from "@/lib/workspace";

export async function createWorkspace(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/?error=" + encodeURIComponent("Give the project a name."));

  const supabase = await createClient();
  const base = slugify(name);
  // Add -2, -3… if the owner already has a project with this slug.
  const { data: taken } = await supabase.from("workspaces").select("slug").eq("owner_id", user.id).like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((w) => w.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base.slice(0, 44)}-${i}`;

  const { error } = await supabase.from("workspaces").insert({ name: name.slice(0, 80), slug, color: String(formData.get("color") || "#7c5cff") });
  if (error) redirect("/?error=" + encodeURIComponent(error.message));
  redirect(`/w/${slug}/settings?welcome=1`);
}
