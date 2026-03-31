CREATE TABLE public.player_sync_metadata (
  puuid text PRIMARY KEY,
  latest_riot_match_id text,
  latest_riot_match_created_at bigint,
  latest_db_match_id text,
  latest_db_match_created_at bigint,
  recent_match_window integer NOT NULL DEFAULT 25 CHECK (recent_match_window > 0),
  reconciled_through_match_created_at bigint,
  last_riot_sync_at timestamptz,
  last_full_refresh_at timestamptz,
  last_stale_derived_refresh_at timestamptz,
  last_known_account_game_name text,
  last_known_account_tag_line text,
  derivation_version text,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_player_sync_metadata_last_riot_sync
  ON public.player_sync_metadata (last_riot_sync_at DESC NULLS LAST);

CREATE INDEX idx_player_sync_metadata_latest_db_match_created
  ON public.player_sync_metadata (latest_db_match_created_at DESC NULLS LAST);

ALTER TABLE public.player_sync_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select" ON public.player_sync_metadata
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.set_player_sync_metadata_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_player_sync_metadata_updated_at
BEFORE UPDATE ON public.player_sync_metadata
FOR EACH ROW
EXECUTE FUNCTION public.set_player_sync_metadata_updated_at();
