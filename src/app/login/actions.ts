"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailAllowed } from "@/lib/workspace";

/** Only same-site paths: "//host" and "/\\host" would send the user off-site. */
function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "/");
  return /^\/(?![\/\\])/.test(next) ? next : "/";
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(safeNext(formData.get("next")));
}

export async function signUp(formData: FormData) {
  if (!emailAllowed(String(formData.get("email") ?? ""))) {
    redirect(`/login?mode=signup&error=${encodeURIComponent("Sign-ups are closed on this CtrlAltSocials.")}`);
  }
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect("/login?message=check-email");
  // Signing up from an invite link carries on to it.
  redirect(safeNext(formData.get("next")));
}
