import Link from "next/link";
import { PlatformIcon } from "@/components/platform-icon";
import { SubmitButton } from "@/components/submit-button";
import { decryptJson } from "@/lib/crypto";
import type { ConnectResult } from "@/lib/platforms/adapters/shared";
import { getPlatform, type PlatformId } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/workspace";
import { pickConnection } from "../../actions";

export const metadata = { title: "Choose an account" };

export default async function PickPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { slug } = await params;
  const { id = "" } = await searchParams;
  const ws = await requireOwner(slug);
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("pending_connections")
    .select("id, platform, choices, expires_at")
    .eq("id", id)
    .eq("workspace_id", ws.id)
    .maybeSingle();

  if (!pending || new Date(pending.expires_at) < new Date()) {
    return (
      <div className="card max-w-lg space-y-3">
        <p>That choice has expired. Connect the account again.</p>
        <Link href={`/w/${slug}/accounts`} className="btn-ghost">Back to accounts</Link>
      </div>
    );
  }

  const platform = getPlatform(pending.platform)!;
  // Only names go to the page; credentials stay server-side.
  const names = decryptJson<ConnectResult<unknown>[]>(pending.choices).map((c) => c.label);

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Which {platform.name} belongs to {ws.name}?</h1>
        <p className="text-sm text-muted">That sign-in can post to {names.length} of them. Pick the one for this project; the others aren&apos;t saved.</p>
      </div>
      <ul className="space-y-2">
        {names.map((name, index) => (
          <li key={index}>
            <form action={pickConnection.bind(null, slug, pending.id, index)} className="card flex items-center gap-3 p-4">
              <PlatformIcon platform={pending.platform as PlatformId} />
              <span className="flex-1 font-medium">{name}</span>
              <SubmitButton className="btn-primary px-3 py-1.5 text-xs" pendingText="Connecting…">Use this one</SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      <Link href={`/w/${slug}/accounts`} className="text-sm text-muted hover:text-fg">Cancel</Link>
    </div>
  );
}
