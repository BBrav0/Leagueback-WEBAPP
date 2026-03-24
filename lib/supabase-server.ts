import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for API routes and lib modules used only on the server.
 *
 * **Service role and RLS:** When `SUPABASE_SERVICE_ROLE_KEY` is set, this client
 * bypasses Row Level Security. That is an intentional product decision: match and
 * account data for this app are backend-owned (no end-user Supabase auth on these
 * tables). The key must exist only in server env — importing this module from a
 * client bundle fails at build time (`server-only`).
 *
 * Prefer the service role so RLS misconfiguration cannot block reads/writes.
 * Falls back to the anon key if the service role is unset (local dev).
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error(
    "Missing Supabase environment variables. Set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_*)."
  );
}

const serverKey = serviceRoleKey || anonKey;

if (process.env.NODE_ENV === "development" && !serviceRoleKey) {
  console.warn(
    "[supabase-server] SUPABASE_SERVICE_ROLE_KEY is not set; using anon key. Server routes may be blocked by RLS."
  );
}

export const supabaseServer: SupabaseClient = createClient(supabaseUrl, serverKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
