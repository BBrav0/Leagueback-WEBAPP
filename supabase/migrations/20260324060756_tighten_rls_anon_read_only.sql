-- Remove anon write policies from original tables
DROP POLICY IF EXISTS "Allow anon insert" ON public.accounts;
DROP POLICY IF EXISTS "Allow anon update" ON public.accounts;
DROP POLICY IF EXISTS "Allow anon insert" ON public.impact_categories;
DROP POLICY IF EXISTS "Allow anon update" ON public.impact_categories;
DROP POLICY IF EXISTS "Allow anon insert" ON public.match_details;
DROP POLICY IF EXISTS "Allow anon update" ON public.match_details;
DROP POLICY IF EXISTS "Allow anon insert" ON public.match_timelines;
DROP POLICY IF EXISTS "Allow anon update" ON public.match_timelines;

-- Remove write policies from new tables (these defaulted to PUBLIC, not service_role only)
DROP POLICY IF EXISTS "Allow service_role insert" ON public.player_matches;
DROP POLICY IF EXISTS "Allow service_role update" ON public.player_matches;
DROP POLICY IF EXISTS "Allow service_role insert" ON public.match_cache;
DROP POLICY IF EXISTS "Allow service_role update" ON public.match_cache;

-- All tables now have only "Allow anon select" remaining.
-- Writes are handled via service_role key which bypasses RLS entirely.
