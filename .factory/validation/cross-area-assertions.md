### VAL-CROSS-001: End-to-end account lookup resolves against Neon
**Description:** Searching a Riot ID (e.g., `PlayerName#NA1`) through the UI search form triggers `GET /api/account?gameName=PlayerName&tagLine=NA1`. The route must query the Neon-backed `accounts` table (via `getAccountByRiotId` in `lib/riot-api-service.ts`) and return a JSON body containing `{ puuid, gameName, tagLine }`. A cache-hit path (account already in Neon) and a cache-miss path (fetched from Riot API then written to Neon) must both succeed.
**Pass condition:** Response status is 200 and body contains non-empty `puuid`, `gameName`, and `tagLine` fields. For the cache-miss path, the `accounts` row must be verifiable in the Neon database after the request completes.
**Evidence:** HTTP response body from `/api/account`; SQL query `SELECT puuid, game_name, tag_line FROM accounts WHERE game_name ILIKE 'PlayerName' AND tag_line ILIKE 'NA1'` returns a matching row in Neon.

---

### VAL-CROSS-002: Match history IDs returned after account resolution
**Description:** After a successful account lookup (VAL-CROSS-001), the frontend calls `GET /api/match-history?puuid=<puuid>&count=10&start=0`. The response must be a JSON array of match ID strings (format: region prefix + underscore + numeric, e.g., `NA1_1234567890`).
**Pass condition:** Response status is 200 and body is a non-empty JSON array of strings. Each string matches the pattern `/^[A-Z]{2,4}\d?_\d+$/`.
**Evidence:** HTTP response body from `/api/match-history`; array length ≥ 1.

---

### VAL-CROSS-003: Match performance pipeline writes to Neon player_matches
**Description:** For a match ID returned by VAL-CROSS-002, calling `GET /api/match-performance?matchId=<id>&userPuuid=<puuid>` must: (1) check `match_cache` in Neon, (2) fetch from Riot API if cold, (3) compute impact scores via `reconstructMatchSummary`, (4) upsert into `player_matches` in Neon, and (5) upsert into `match_cache` in Neon. The response must contain `{ success: true, matchSummary: {...} }`.
**Pass condition:** Response status is 200, `success` is `true`, `matchSummary` contains required fields (`id`, `champion`, `kda`, `gameResult`, `yourImpact`, `teamImpact`, `data`). No `playerMatchesPersistError` or `matchCachePersistError` keys present in the response (indicating successful Neon writes).
**Evidence:** HTTP response body; SQL queries `SELECT * FROM player_matches WHERE match_id = '<id>' AND puuid = '<puuid>'` and `SELECT match_id FROM match_cache WHERE match_id = '<id>'` both return rows in Neon.

---

### VAL-CROSS-004: Stored matches pagination reads from Neon
**Description:** After at least one match has been processed via VAL-CROSS-003, calling `GET /api/stored-matches?puuid=<puuid>&limit=20&offset=0` must read from the Neon `player_matches` table and return paginated results.
**Pass condition:** Response status is 200 and body contains `{ matches: [...], totalCount: <number>, hasMore: <boolean> }`. `matches` is an array of objects each containing `id`, `champion`, `kda`, `gameResult`, `yourImpact`, `teamImpact`, `gameTime`, and `data`. `totalCount` ≥ 1.
**Evidence:** HTTP response body from `/api/stored-matches`.

---

### VAL-CROSS-005: Impact categories endpoint reads from Neon player_matches
**Description:** `GET /api/impact-categories?puuid=<puuid>` must query the `player_matches` table in Neon and return impact category data derived from the `impact_category` column.
**Pass condition:** Response status is 200 and body contains `{ categories: [...] }`. Each element in `categories` is one of `"impactWins"`, `"impactLosses"`, `"guaranteedWins"`, or `"guaranteedLosses"`.
**Evidence:** HTTP response body from `/api/impact-categories`.

---

### VAL-CROSS-006: Full user flow renders match cards in the browser
**Description:** A user navigating to `localhost:3005`, entering a Riot ID in the search form, and submitting it must see match cards rendered in the dashboard. Each card must display: champion name, KDA, game result (Victory/Defeat), impact score chart, and game duration. The data displayed must originate from the Neon-backed API pipeline (VAL-CROSS-001 → 002 → 003 → 004).
**Pass condition:** The browser renders at least one match card containing visible champion text, KDA text, and a Victory or Defeat badge. No blank/empty card placeholders remain after loading completes.
**Evidence:** Browser screenshot or DOM inspection showing rendered match card elements; network tab confirming successful 200 responses from `/api/account`, `/api/match-history`, `/api/match-performance`, and `/api/stored-matches`.

---

### VAL-CROSS-007: App page loads without JavaScript errors
**Description:** Loading the app at `localhost:3005` and performing a Riot ID search must not produce any uncaught JavaScript errors in the browser console. Warnings are acceptable; errors are not.
**Pass condition:** Browser console contains zero entries at severity level "error" during page load and search flow. `console.warn` entries are allowed.
**Evidence:** Browser console log export filtered to severity "error" showing zero entries.

---

### VAL-CROSS-008: API endpoints return valid JSON with correct Content-Type
**Description:** All five core API endpoints (`/api/account`, `/api/match-history`, `/api/match-performance`, `/api/stored-matches`, `/api/impact-categories`) must return responses with `Content-Type: application/json` and bodies that parse as valid JSON.
**Pass condition:** Every response has a `Content-Type` header containing `application/json`. Every response body is parseable by `JSON.parse()` without throwing.
**Evidence:** HTTP response headers and parsed JSON bodies for each endpoint.

---

### VAL-CROSS-009: API error responses use structured JSON format
**Description:** When API endpoints receive invalid input (e.g., missing `puuid`, missing `matchId`), they must return structured JSON error responses with appropriate HTTP status codes, not HTML error pages or plain text.
**Pass condition:** `GET /api/account` with no params returns `{ "error": "Missing gameName or tagLine" }` with status 400. `GET /api/match-history` with no params returns `{ "error": "Missing puuid" }` with status 400. `GET /api/match-performance` with no params returns `{ "success": false, "error": "Missing matchId or userPuuid" }` with status 400. `GET /api/stored-matches` with no params returns `{ "error": "Missing puuid" }` with status 400. `GET /api/impact-categories` with no params returns `{ "error": "Missing puuid" }` with status 400.
**Evidence:** HTTP response status codes and JSON bodies for each malformed request.

---

### VAL-CROSS-010: No Supabase references visible to end users
**Description:** After migration to Neon, no user-visible surface (browser UI text, API response bodies, browser console output) should mention "Supabase" in error messages, status text, or debug output. Internal server-side log messages (stdout/stderr on the server) are excluded from this check. The known reference in `lol-stats-dashboard.tsx` line 941 (`SUPABASE_SERVICE_ROLE_KEY`) only fires in `development` mode via `console.warn`; it must not appear in production builds.
**Pass condition:** (1) No API JSON response body from any of the five core endpoints contains the substring "supabase" (case-insensitive) in any field value. (2) Browser console output during the full search flow contains no entries with the substring "supabase" (case-insensitive) at any severity level. (3) Rendered HTML/DOM text content does not contain the substring "supabase" (case-insensitive).
**Evidence:** Text search of all API response bodies; browser console log export; DOM `document.body.innerText` search for "supabase".

---

### VAL-CROSS-011: Neon connection string is used instead of Supabase
**Description:** The database client initialization code (`lib/supabase-server.ts` and `lib/supabase.ts`) must connect to a Neon PostgreSQL instance. After migration, the `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` environment variables (or their Neon replacements) must point to a Neon-hosted database, and the connection must succeed for read and write operations.
**Pass condition:** The environment variable used for the database URL resolves to a Neon endpoint (hostname contains `.neon.tech` or equivalent configured Neon domain). A simple read query (`SELECT 1`) through the server client returns successfully. A write query (upsert to `accounts`) through the service-role client returns without RLS errors.
**Evidence:** Value of the effective database URL (redacted credentials); successful SELECT and UPSERT operation logs.

---

### VAL-CROSS-012: Match cache round-trip through Neon
**Description:** The match cache flow must work end-to-end with Neon: (1) first request for a match ID hits Riot API and writes to `match_cache` in Neon, (2) second request for the same match ID reads from `match_cache` in Neon without hitting Riot API. This validates that the cache write and cache read paths both function against the Neon database.
**Pass condition:** First call to `/api/match-performance` for a given `matchId` returns `success: true` with no `matchCachePersistError`. Second call to the same endpoint with the same `matchId` also returns `success: true`, and server logs show no outbound Riot API request for match details or timeline (cache hit).
**Evidence:** Two sequential HTTP responses from `/api/match-performance` for the same `matchId`; server-side logs or network trace showing Riot API was called only on the first request.

---

### VAL-CROSS-013: Infinite scroll loads additional matches from Neon
**Description:** After the initial match cards are displayed (VAL-CROSS-006), scrolling to the bottom of the page triggers the IntersectionObserver in the dashboard component, which calls `GET /api/stored-matches?puuid=<puuid>&limit=20&offset=20` (or the next offset). The response must return additional matches from Neon's `player_matches` table if more exist.
**Pass condition:** The `/api/stored-matches` call with `offset > 0` returns status 200. If `hasMore` was `true` in the initial response, the subsequent response contains a non-empty `matches` array. Match IDs in the second page do not overlap with match IDs in the first page.
**Evidence:** HTTP responses from two paginated `/api/stored-matches` calls showing distinct match ID sets; `hasMore` and `totalCount` values are consistent across pages.

---

### VAL-CROSS-014: Validation fixture flow works without database
**Description:** The deterministic validation fixture (`Validation Fixture#LOCAL`) provides a database-free test path. Searching this identity must return fixture data from `lib/validation-fixture.ts` without touching Neon. This validates that the fixture bypass is intact after migration and can be used for smoke testing without database connectivity.
**Pass condition:** `GET /api/account?gameName=Validation+Fixture&tagLine=LOCAL` returns the fixture account with `puuid = "validation-fixture-puuid"`. `GET /api/match-history?puuid=validation-fixture-puuid&count=10&start=0` returns fixture match IDs. `GET /api/stored-matches?puuid=validation-fixture-puuid&limit=20&offset=0` returns fixture match summaries with `totalCount = 2`. None of these requests trigger Neon database queries.
**Evidence:** HTTP response bodies matching the expected fixture data; server logs showing no database queries during the fixture flow.

---

### VAL-CROSS-015: Player sync metadata persists to Neon
**Description:** The match performance pipeline (VAL-CROSS-003) upserts sync metadata into the `player_sync_metadata` table in Neon after processing each match. The `/api/player-sync-status` endpoint reads this metadata. Both the write path (from `match-performance`) and the read path (from `player-sync-status`) must function against Neon.
**Pass condition:** After processing a match via `/api/match-performance`, `GET /api/player-sync-status?puuid=<puuid>` returns status 200 with `{ lastSyncAt: <non-null ISO timestamp> }`. `POST /api/player-sync-status` with `{ puuid: "<puuid>" }` returns status 200 with `{ success: true, lastSyncAt: <non-null ISO timestamp> }`.
**Evidence:** HTTP response bodies from both GET and POST to `/api/player-sync-status`; SQL query `SELECT * FROM player_sync_metadata WHERE puuid = '<puuid>'` returns a row in Neon.

---

### VAL-CROSS-016: Existing match ID check queries Neon correctly
**Description:** `POST /api/player-matches/existing-ids` accepts a list of match IDs and returns which ones already exist in Neon's `player_matches` table. This is used by the frontend to avoid re-processing already-analyzed matches.
**Pass condition:** After processing match `NA1_12345` via `/api/match-performance`, `POST /api/player-matches/existing-ids` with body `{ puuid: "<puuid>", matchIds: ["NA1_12345", "NA1_99999"] }` returns `{ existingMatchIds: ["NA1_12345"] }` — confirming the processed match is found in Neon and the unprocessed one is not.
**Evidence:** HTTP response body from `/api/player-matches/existing-ids`.

---

### VAL-CROSS-017: Data integrity across Neon tables
**Description:** After the full user flow (search → match history → match performance), data written to Neon must be consistent across tables. The `puuid` in `accounts` must match the `puuid` in `player_matches` and `player_sync_metadata`. The `match_id` in `player_matches` must have a corresponding entry in `match_cache`. Impact categories stored in `player_matches` must be valid enum values.
**Pass condition:** For a given puuid: (1) `accounts` contains a row with that puuid. (2) `player_matches` contains ≥ 1 row with that puuid, and every row has `impact_category` in `('impactWins', 'impactLosses', 'guaranteedWins', 'guaranteedLosses')`. (3) Every `match_id` in `player_matches` for that puuid has a corresponding row in `match_cache`. (4) `player_sync_metadata` contains a row with that puuid.
**Evidence:** SQL join queries across all four tables in Neon confirming referential consistency.
