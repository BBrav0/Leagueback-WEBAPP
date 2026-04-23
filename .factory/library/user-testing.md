# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

---

## Validation Surface

**Primary surface:** Browser (Next.js web application on localhost:3005)

**Tool:** agent-browser skill
- Confirmed working in dry run
- MUST use semantic locators (`find placeholder`, `find role button --name`, `find text`) — ref-based `@eN` times out on this app's Radix UI components
- Screenshots and DOM inspection both work

**Limitations:**
- `RIOT_API_KEY` may not be available in dev — Riot API calls will fail with "RIOT_API_KEY is not configured"
- Testing focuses on UI state correctness, sync gate behavior, and DB-only flows
- Full end-to-end with real Riot API data requires the key to be set

**App entry point:** http://localhost:3005
- Search form with "Game name" and "Tag line" inputs
- After search, profile page shows match cards, impact stats, sync status bar

## Validation Concurrency

**Machine:** 32 GB RAM, 24 logical cores, ~15 GB free at baseline
**Agent-browser cost:** ~1 GB RAM per instance (Chromium + Node)
**Dev server cost:** ~200 MB RAM (shared across validators)
**Usable headroom:** 15 GB * 0.7 = ~10.5 GB
**Max concurrent validators:** 5 (5 * 1 GB + 0.2 GB = 5.2 GB, well within budget)

## Testing Notes

- The dev server must be running on port 3005 before testing
- The Validation Fixture ("Validation Fixture#LOCAL") bypasses sync gate entirely — use it for UI-only testing
- For sync gate behavior testing, need actual player data in the DB or mock the sync status API responses

## Flow Validator Guidance: browser

- Use `agent-browser` with a non-default session and semantic locators only.
- Stay on `http://localhost:3005`; do not open alternate ports.
- The Validation Fixture (`Validation Fixture#LOCAL`) is safe for deterministic UI/runtime checks, but it bypasses server-side sync gate enforcement and does not prove DB-backed freshness behavior.
- Current environment blocker: Neon/Supabase host resolution is failing (`api.pooler.supabase.com` ENOTFOUND in `dev-server.log`), so any flow that depends on `player_sync_metadata`, `player_matches`, or sync timestamp persistence against the real DB is not isolated enough for live validation right now.
- If using the fixture, confine testing to route hydration, deterministic stored-match rendering, and fixture-backed match-history behavior. Do not claim fresh/stale/expired sync-gate assertions as passed from fixture-only evidence.
