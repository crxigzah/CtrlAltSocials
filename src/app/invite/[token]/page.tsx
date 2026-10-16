import { createHash } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/workspace";

export const metadata = { title: "Join a project" };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const ERRORS: Record<string, string> = {
  invite_not_found: "This invite link has already been used or was cancelled.",
  invite_expired: "This invite link has expired. Ask for a new one.",
  invite_wrong_email: "This invite is for a different email address. Sign in with that one.",
};

async function accept(token: string) {
  "use server";
  await requireUser();
  const supabase = await createClient();
  const { data: slug, error } = await supabase.rpc("accept_invite", { hash: hash(token) });
  if (error) {
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(code ? ERRORS[code] : error.message)}`);
  }
  redirect(`/w/${slug}?joined=1`);
}

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("invite_details", { hash: hash(token) });
  const invite = (data as { workspace_name: string; email: string | null; expired: boolean }[] | null)?.[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <Logo className="justify-center" />
      <div className="card space-y-4">
        {error && <p className="notice-error">{error}</p>}
        {!invite ? (
          <p>{ERRORS.invite_not_found}</p>
        ) : invite.expired ? (
          <p>{ERRORS.invite_expired}</p>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Join {invite.workspace_name}</h1>
            <p className="text-sm text-muted">
              You&apos;ll be an editor: you can write, schedule and import posts for {invite.workspace_name}&apos;s accounts. The owner keeps control of
              the accounts and settings.
            </p>
            {invite.email && invite.email !== user.email?.toLowerCase() && (
              <p className="notice-error">This invite is for {invite.email}, but you&apos;re signed in as {user.email}.</p>
            )}
            <form action={accept.bind(null, token)}>
              <SubmitButton className="btn-primary w-full" pendingText="Joining…">Join as {user.email}</SubmitButton>
            </form>
          </>
        )}
        <Link href="/" className="block text-center text-sm text-muted hover:text-fg">Go to your projects</Link>
      </div>
    </main>
  );
}
