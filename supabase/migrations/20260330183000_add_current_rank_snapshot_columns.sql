ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS summoner_id text;

ALTER TABLE public.player_matches
  ADD COLUMN IF NOT EXISTS rank text,
  ADD COLUMN IF NOT EXISTS rank_queue text CHECK (rank_queue IN ('RANKED_SOLO_5x5', 'RANKED_FLEX_SR'));
