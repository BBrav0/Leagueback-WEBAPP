-- Initial LeagueBack schema: accounts, match_details, match_timelines, impact_categories

CREATE TABLE public.accounts (
  puuid      text PRIMARY KEY,
  game_name  text NOT NULL,
  tag_line   text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_accounts_game_tag ON public.accounts (game_name, tag_line);

CREATE TABLE public.match_details (
  match_id   text PRIMARY KEY,
  match_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.match_timelines (
  match_id      text PRIMARY KEY,
  timeline_data jsonb NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE public.impact_categories (
  match_id   text NOT NULL,
  puuid      text NOT NULL,
  category   text NOT NULL CHECK (category IN ('impactWins', 'impactLosses', 'guaranteedWins', 'guaranteedLosses')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (match_id, puuid)
);

CREATE INDEX idx_impact_puuid ON public.impact_categories (puuid);
