"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, slugify } from "@/lib/workspace";

export async function createWorkspace(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/?error=" + encodeURIComponent("Give the project a name."));

  const supabase = await createClient();
  const base = slugify(name);
  const color = String(formData.get("color") || "#7c5cff");
  // Slugs are unique across everyone's projects, most of which this user can't see,
  // so just try base, base-2, base-3… until the database accepts one.
  let slug = base;
  for (let i = 2; i <= 50; i++) {
    const { error } = await supabase.from("workspaces").insert({ name: name.slice(0, 80), slug, color });
    if (!error) redirect(`/w/${slug}/settings?welcome=1`);
    if (error.code !== "23505") redirect("/?error=" + encodeURIComponent(error.message));
    slug = `${base.slice(0, 44)}-${i}`;
  }
  redirect("/?error=" + encodeURIComponent("Couldn't find a free web address for that name; try a different one."));
}
