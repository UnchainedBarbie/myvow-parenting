import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Uses anon key — read-only via RLS.
 * All writes MUST go through API routes using the service role.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
