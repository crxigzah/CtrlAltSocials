import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/lib/types";
import { requireUser } from "@/lib/workspace";

export const metadata = { title: "Share" };

/** Where the phone's share sheet lands: pick a project, then the composer opens with the shared text. */
export default async function SharePage({ searchParams }: { searchParams: Promise<{ title?: string; text?: string; url?: string }> }) {
  const { title, text, url } = await searchParams;
  await requireUser();
  // Apps fill these differently (some put the link in text, some in url); keep each piece once.
  const pieces = [title, text, url].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  const shared = pieces.filter((p, i) => !pieces.some((q, j) => j !== i && q.includes(p) && (q !== p || j < i))).join("\n").slice(0, 5000);

  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("slug, name, color").order("created_at").returns<Pick<Workspace, "slug" | "name" | "color">[]>();
  const workspaces = data ?? [];
  const target = (slug: string) => `/w/${slug}?text=${encodeURIComponent(shared)}`;
  if (workspaces.length === 1) redirect(target(workspaces[0].slug));

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-lg space-y-4 px-4 py-8">
        <h1 className="text-xl font-semibold">Post this to which project?</h1>
        {shared && <p className="card whitespace-pre-wrap break-words p-4 text-sm text-muted">{shared}</p>}
        <ul className="space-y-2">
          {workspaces.map((w) => (
            <li key={w.slug}>
              <Link href={target(w.slug)} className="card flex items-center gap-3 p-4 hover:border-accent/60">
                <span className="h-6 w-6 rounded-md" style={{ background: w.color }} />
                <span className="font-medium">{w.name}</span>
              </Link>
            </li>
          ))}
        </ul>
        {workspaces.length === 0 && <p className="text-sm text-muted">Create a project first.</p>}
      </main>
    </>
  );
}
