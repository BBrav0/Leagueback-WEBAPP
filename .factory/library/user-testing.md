# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

---

## Validation Surface

### Browser (Primary)
- **URL:** http://localhost:3005
- **Tool:** agent-browser
- **What to test:** Full user flow — search Riot ID, see match cards, verify data loads
- **Setup:** Start dev server with `pnpm dev` (port 3005)

### API Endpoints (Secondary)
- **Tool:** curl
- **Endpoints:**
  - `GET /api/account?gameName=...&tagLine=...`
  - `GET /api/match-history?puuid=...&count=10&start=0`
  - `GET /api/match-performance?matchId=...&userPuuid=...`
  - `GET /api/stored-matches?puuid=...&limit=20&offset=0`
  - `GET /api/impact-categories?puuid=...`
  - `POST /api/player-matches/existing-ids` (body: `{ puuid, matchIds }`)
  - `POST /api/player-matches/stale-ids` (body: `{ puuid, matchIds }`)
  - `GET /api/player-sync-status?puuid=...`
  - `POST /api/player-sync-status` (body: `{ puuid }`)

### Validation Fixture
- **Identity:** `Validation Fixture#LOCAL` (puuid: `validation-fixture-puuid`)
- **Purpose:** Database-free smoke test path
- **Works without:** DATABASE_URL, RIOT_API_KEY

## Validation Concurrency

- **Machine:** 32GB RAM, ~17GB available at baseline
- **Dev server:** ~200MB RAM
- **agent-browser instance:** ~300MB RAM
- **Max concurrent validators:** 5 (5 * 300MB + 200MB = 1.7GB, well within 12GB * 0.7 = 8.4GB budget)

## Known Considerations

- The app needs `RIOT_API_KEY` for live data flows (looking up real Riot IDs)
- Without `RIOT_API_KEY`, only the validation fixture flow works
- The ESLint ignore for `.open-next/**` must be fixed before `pnpm lint` will pass
