"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkspaceNav({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const pathname = usePathname();
  const base = `/w/${slug}`;
  const allTabs = [
    { href: base, label: "Compose" },
    { href: `${base}/calendar`, label: "Calendar" },
    { href: `${base}/import`, label: "Import" },
    { href: `${base}/insights`, label: "Insights" },
    { href: `${base}/accounts`, label: "Accounts", ownerOnly: true },
    { href: `${base}/setup`, label: "Setup checklist", ownerOnly: true },
    { href: `${base}/settings`, label: "Brand kit", ownerOnly: true },
    { href: `${base}/preferences`, label: "Settings", ownerOnly: true },
  ];
  // Editors don't see the owner's pages (they'd only be sent back from them).
  const tabs = allTabs.filter((t) => isOwner || !("ownerOnly" in t));
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
