import Link from "next/link";
import { Logo } from "@/components/logo";
import { SubmitButton } from "@/components/submit-button";
import { signIn, signUp } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string; message?: string; next?: string }>;
}) {
  const { mode, error, message, next = "/" } = await searchParams;
  const isSignup = mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <Logo className="justify-center" />
      <div className="card space-y-4">
        <h1 className="text-lg font-semibold">{isSignup ? "Create your account" : "Sign in"}</h1>
        {error && <p className="notice-error">{error}</p>}
        {message === "check-email" && <p className="notice-ok">Check your email to confirm your account, then sign in.</p>}
        <form action={isSignup ? signUp : signIn} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required className="input" autoComplete="email" />
          </div>
          <div>
            <label className="field-label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required minLength={8} className="input"
              autoComplete={isSignup ? "new-password" : "current-password"} />
          </div>
          <SubmitButton className="btn-primary w-full">{isSignup ? "Create account" : "Sign in"}</SubmitButton>
        </form>
        <p className="text-center text-sm text-muted">
          {isSignup ? (
            <>Already have an account? <Link href="/login" className="link">Sign in</Link></>
          ) : (
            <>New here? <Link href="/login?mode=signup" className="link">Create an account</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
