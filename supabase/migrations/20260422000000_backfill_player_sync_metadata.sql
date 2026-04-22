-- Backfill player_sync_metadata for existing players in player_matches
-- who don't already have a metadata row.
-- last_riot_sync_at is set to NULL so computeSyncAge treats them as "stale"
-- (not "expired") when they have stored matches.

INSERT INTO public.player_sync_metadata (puuid, last_riot_sync_at)
SELECT DISTINCT pm.puuid, CAST(NULL AS timestamptz)
FROM public.player_matches pm
WHERE NOT EXISTS (
  SELECT 1
  FROM public.player_sync_metadata psm
  WHERE psm.puuid = pm.puuid
)
ON CONFLICT (puuid) DO NOTHING;
