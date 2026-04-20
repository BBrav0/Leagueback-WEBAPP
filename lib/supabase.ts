import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Anon-key client (e.g. for any future browser usage).
 * API routes and server-only modules should use `./supabase-server` so writes/reads
 * can use the service role and bypass RLS when needed.
 *
 * Uses lazy initialisation so that `process.env` is read at call-time rather than
 * module-load time — required by Cloudflare Workers where env vars are only
 * available inside a request context.
 */

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for client-side)."
    );
  }

  _supabase = createClient(supabaseUrl, supabaseAnonKey);
  return _supabase;
}

/** @deprecated Use `getSupabase()` instead — kept for backwards compat. */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  },
});
