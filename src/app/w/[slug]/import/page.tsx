import { getWorkspace } from "@/lib/workspace";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import" };

export default async function ImportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const ws = await getWorkspace(slug);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import from a spreadsheet</h1>
        <p className="max-w-2xl text-sm text-muted">
          Plan posts in Excel or Google Sheets, then paste the cells here or upload the CSV. You&apos;ll see each row checked before anything is
          created. Times are in {ws.name}&apos;s timezone ({ws.timezone}).
        </p>
      </div>
      {error && <p className="notice-error">{error}</p>}
      <div className="card space-y-2 text-sm">
        <div className="font-medium">Columns (first row is the headings)</div>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li><code className="font-mono text-fg">text</code>: the post. Required.</li>
          <li><code className="font-mono text-fg">when</code>: <code className="font-mono">2026-10-20 18:00</code>, <code className="font-mono">20/10/2026 18:00</code>, <code className="font-mono">queue</code> (next free posting slot) or blank for a draft.</li>
          <li><code className="font-mono text-fg">accounts</code>: optional. Platform names or account labels, e.g. <code className="font-mono">bluesky, X</code>. Blank means every account.</li>
          <li><code className="font-mono text-fg">repeat</code>: optional. <code className="font-mono">weekly</code>, <code className="font-mono">fortnightly</code> or <code className="font-mono">monthly</code>.</li>
        </ul>
      </div>
      <ImportForm slug={slug} timeZone={ws.timezone} />
    </div>
  );
}
