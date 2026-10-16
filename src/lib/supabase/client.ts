import { createBrowserClient } from "@supabase/ssr";

/** Browser client (uses the signed-in user's session cookie). */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
