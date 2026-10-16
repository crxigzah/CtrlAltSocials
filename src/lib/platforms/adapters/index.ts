import "server-only";
import type { PlatformId } from "@/lib/platforms/catalog";
import { bluesky } from "./bluesky";
import { discord } from "./discord";
import { facebook } from "./facebook";
import { instagram } from "./instagram";
import { PlatformError, type Adapter, type OAuthAdapter } from "./shared";
import { threads } from "./threads";
import { tiktok } from "./tiktok";
import { x } from "./x";
import { youtube } from "./youtube";

export { PlatformError } from "./shared";

const ADAPTERS: Partial<Record<PlatformId, Adapter<never>>> = {
  bluesky: bluesky as Adapter<never>,
  discord: discord as Adapter<never>,
  threads: threads as Adapter<never>,
  instagram: instagram as Adapter<never>,
  facebook: facebook as Adapter<never>,
  youtube: youtube as Adapter<never>,
  tiktok: tiktok as Adapter<never>,
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

/** True for failures to reach the platform at all (DNS, timeouts, resets), as opposed to the platform saying no. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && err.message === "fetch failed";
}

/** Message safe to show the user: platform errors verbatim, anything else generic. */
export function describeError(err: unknown): string {
  if (err instanceof PlatformError) return err.message.slice(0, 500);
  if (isNetworkError(err)) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return `Couldn't reach the platform (${cause?.code ?? cause?.message ?? "network error"}). It'll work on a retry once the connection's back.`;
  }
  console.error(err);
  return "Something went wrong talking to the platform. Try again in a minute.";
}
