"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkspaceNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/w/${slug}`;
  const tabs = [
    { href: base, label: "Compose" },
    { href: `${base}/calendar`, label: "Calendar" },
    { href: `${base}/accounts`, label: "Accounts" },
    { href: `${base}/setup`, label: "Setup checklist" },
    { href: `${base}/settings`, label: "Brand kit" },
    { href: `${base}/preferences`, label: "Settings" },
  ];
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
