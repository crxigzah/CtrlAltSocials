import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { PlatformIcon } from "@/components/platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import type { Account, Workspace } from "@/lib/types";
import { requireUser } from "@/lib/workspace";
import { createWorkspace } from "./actions";

export const metadata = { title: "Projects" };

type Row = Workspace & { accounts: Pick<Account, "id" | "platform" | "status">[] };

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("*, accounts(id, platform, status)")
    .order("created_at")
    .returns<Row[]>();
  const workspaces = data ?? [];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted">Each project keeps its own accounts. A post written in one can only go to that project&apos;s accounts.</p>
        </div>

        {error && <p className="notice-error">{error}</p>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => (
            <Link key={w.id} href={`/w/${w.slug}`} className="card block transition hover:border-accent/60">
              <div className="flex items-center gap-3">
                <span className="h-9 w-9 rounded-lg" style={{ background: w.color }} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{w.name}</div>
                  <div className="text-xs text-muted">{w.handle ? `@${w.handle}` : "No handle set"}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {w.accounts.length === 0 && <span className="text-xs text-subtle">No accounts connected yet</span>}
                {w.accounts.map((a) => (
                  <span key={a.id} className={a.status === "connected" ? "" : "opacity-40"} title={a.platform}>
                    <PlatformIcon platform={a.platform} size={24} />
                  </span>
                ))}
              </div>
            </Link>
          ))}

          <form action={createWorkspace} className="card space-y-3 border-dashed">
            <div className="font-semibold">New project</div>
            <input name="name" required maxLength={80} placeholder="e.g. 5kable" className="input" />
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted" htmlFor="color">Colour</label>
              <input id="color" name="color" type="color" defaultValue="#2dd4bf" className="h-8 w-12 cursor-pointer rounded border border-line bg-raised" />
              <SubmitButton className="btn-primary ml-auto">Create</SubmitButton>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
