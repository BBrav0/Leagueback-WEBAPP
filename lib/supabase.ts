import { createClient } from "@supabase/supabase-js";

// Get Supabase URL and key from environment variables
// Support both NEXT_PUBLIC_ prefix (for client-side) and regular (for server-side)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for client-side)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
