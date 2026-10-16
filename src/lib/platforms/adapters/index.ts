import "server-only";
import type { PlatformId } from "@/lib/platforms/catalog";
import { bluesky } from "./bluesky";
import { discord } from "./discord";
import { facebook } from "./facebook";
import { instagram } from "./instagram";
import { PlatformError, type Adapter, type OAuthAdapter } from "./shared";
import { threads } from "./threads";
import { x } from "./x";

export { PlatformError } from "./shared";

const ADAPTERS: Partial<Record<PlatformId, Adapter<never>>> = {
  bluesky: bluesky as Adapter<never>,
  discord: discord as Adapter<never>,
  threads: threads as Adapter<never>,
  instagram: instagram as Adapter<never>,
  facebook: facebook as Adapter<never>,
  x: x as Adapter<never>,
};

export function getAdapter(platform: string) {
  return ADAPTERS[platform as PlatformId] as Adapter<unknown> | undefined;
}

export function getOAuthAdapter(platform: string) {
  const adapter = getAdapter(platform);
  return adapter?.kind === "oauth" ? (adapter as OAuthAdapter<unknown>) : undefined;
}

/** Env vars an OAuth platform still needs before it can be connected; empty when it's ready. */
export function missingEnv(platform: string): string[] {
  const adapter = getOAuthAdapter(platform);
  return adapter ? adapter.env.filter((name) => !process.env[name]) : [];
}

/** Message safe to show the user: platform errors verbatim, anything else generic. */
export function describeError(err: unknown): string {
  if (err instanceof PlatformError) return err.message.slice(0, 500);
  console.error(err);
  return "Something went wrong talking to the platform. Try again in a minute.";
}
