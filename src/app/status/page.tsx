import { AppHeader } from "@/components/app-header";
import { runHealthChecks, type CheckState } from "@/lib/health";
import { requireUser } from "@/lib/workspace";

export const metadata = { title: "Status" };
export const dynamic = "force-dynamic";

// Icon + word as well as colour, so the state never relies on colour alone.
const STATE: Record<CheckState, { icon: string; word: string; cls: string }> = {
  ok: { icon: "✓", word: "OK", cls: "text-ok" },
  warn: { icon: "!", word: "Check", cls: "text-warn" },
  fail: { icon: "✕", word: "Broken", cls: "text-bad" },
  off: { icon: "–", word: "Off", cls: "text-subtle" },
};

export default async function StatusPage() {
  await requireUser();
  const checks = await runHealthChecks();
  const groups = [...new Set(checks.map((c) => c.group))];
  const failing = checks.filter((c) => c.state === "fail").length;
  const warnings = checks.filter((c) => c.state === "warn").length;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Status</h1>
          <p className={`text-sm ${failing ? "text-bad" : warnings ? "text-warn" : "text-ok"}`}>
            {failing
              ? `${failing} thing${failing === 1 ? "" : "s"} need${failing === 1 ? "s" : ""} fixing before everything works.`
              : warnings
                ? `Working, with ${warnings} thing${warnings === 1 ? "" : "s"} worth checking.`
                : "Everything's set up."}
          </p>
        </div>
        {groups.map((group) => (
          <section key={group} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted">{group}</h2>
            <ul className="card divide-y divide-line p-0">
              {checks
                .filter((c) => c.group === group)
                .map((c) => {
                  const s = STATE[c.state];
                  return (
                    <li key={c.label} className="flex gap-3 px-4 py-3 text-sm">
                      <span className={`w-16 shrink-0 font-medium ${s.cls}`}>
                        <span aria-hidden className="mr-1 font-mono">{s.icon}</span>
                        {s.word}
                      </span>
                      <span className="w-40 shrink-0 font-medium">{c.label}</span>
                      <span className="min-w-0 flex-1 break-words text-muted">{c.detail}</span>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
