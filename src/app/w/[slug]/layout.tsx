import { AppHeader } from "@/components/app-header";
import { getWorkspace } from "@/lib/workspace";
import { WorkspaceNav } from "./nav";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ws = await getWorkspace(slug);
  return (
    <>
      <AppHeader>
        <span className="flex items-center gap-2 text-sm">
          <span className="text-subtle">/</span>
          <span className="h-3 w-3 rounded" style={{ background: ws.color }} />
          <span className="font-medium">{ws.name}</span>
        </span>
      </AppHeader>
      <div className="border-b border-line">
        <WorkspaceNav slug={ws.slug} />
      </div>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
