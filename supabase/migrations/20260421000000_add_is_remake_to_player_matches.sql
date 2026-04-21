ALTER TABLE player_matches ADD COLUMN IF NOT EXISTS is_remake boolean NOT NULL DEFAULT false;

-- Backfill: mark existing short games as remakes (heuristic for historical data)
UPDATE player_matches SET is_remake = true WHERE game_duration < 300;
