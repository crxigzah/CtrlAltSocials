import Link from "next/link";
import { Logo } from "@/components/logo";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-panel/60">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/" aria-label="All projects"><Logo /></Link>
        <div className="flex-1">{children}</div>
        <form action="/auth/signout" method="post">
          <button className="text-sm text-muted hover:text-fg">Sign out</button>
        </form>
      </div>
    </header>
  );
}
