-- Create player_matches table (precomputed per-player match summaries)
CREATE TABLE public.player_matches (
  match_id   text NOT NULL,
  puuid      text NOT NULL,
  champion   text NOT NULL,
  kda        text NOT NULL,
  cs         integer NOT NULL DEFAULT 0,
  vision_score integer NOT NULL DEFAULT 0,
  game_result  text NOT NULL CHECK (game_result IN ('Victory', 'Defeat')),
  game_time    text NOT NULL,
  your_impact  double precision NOT NULL DEFAULT 0,
  team_impact  double precision NOT NULL DEFAULT 0,
  impact_category text NOT NULL CHECK (impact_category IN ('impactWins', 'impactLosses', 'guaranteedWins', 'guaranteedLosses')),
  chart_data   jsonb NOT NULL DEFAULT '[]'::jsonb,
  game_creation bigint NOT NULL DEFAULT 0,
  game_duration integer NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (match_id, puuid)
);

-- Index for fast paginated lookups by player, ordered by game time
CREATE INDEX idx_player_matches_puuid_game ON public.player_matches (puuid, game_creation DESC);

-- Index for impact category aggregation queries
CREATE INDEX idx_player_matches_puuid_category ON public.player_matches (puuid, impact_category);

-- Create match_cache table (cold storage for raw Riot JSON)
CREATE TABLE public.match_cache (
  match_id      text PRIMARY KEY,
  match_data    jsonb NOT NULL,
  timeline_data jsonb NOT NULL,
  cached_at     timestamptz DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.player_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies for player_matches
CREATE POLICY "Allow anon select" ON public.player_matches FOR SELECT USING (true);
CREATE POLICY "Allow service_role insert" ON public.player_matches FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service_role update" ON public.player_matches FOR UPDATE USING (true);

-- RLS policies for match_cache
CREATE POLICY "Allow anon select" ON public.match_cache FOR SELECT USING (true);
CREATE POLICY "Allow service_role insert" ON public.match_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service_role update" ON public.match_cache FOR UPDATE USING (true);
