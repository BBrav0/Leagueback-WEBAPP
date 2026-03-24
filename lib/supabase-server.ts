import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for API routes and lib modules used only on the server.
 * Prefer SUPABASE_SERVICE_ROLE_KEY so Row Level Security does not block reads/writes
 * for league data (impact_categories, match_details, etc.). Falls back to the anon
 * key if the service role is unset (local dev). Never import this file from client components.
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
