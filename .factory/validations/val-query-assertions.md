# Validation Contract — Query Migration (Supabase → Neon)

---

## database-queries.ts — Paginated Queries

### VAL-QUERY-001: getPlayerMatchesPaginated returns correct shape and pagination

`getPlayerMatchesPaginated(puuid, limit, offset)` must return `{ matches: MatchSummary[]; totalCount: number; hasMore: boolean }`. The query must filter by `puuid` and `is_remake = false`, order by `game_creation DESC`, and apply `LIMIT`/`OFFSET` (equivalent to Supabase `.range(offset, offset+limit-1)`). The total count must reflect the full filtered row count, not just the page size.

**Pass condition:** For a puuid with 25 non-remake rows, calling with `limit=10, offset=0` returns `matches.length === 10`, `totalCount === 25`, `hasMore === true`. Calling with `limit=10, offset=20` returns `matches.length === 5`, `totalCount === 25`, `hasMore === false`.
**Evidence:** Unit test covering pagination boundaries; `npx vitest run lib/database-queries.test.ts` passes.

### VAL-QUERY-002: getPlayerMatchesPaginated maps rows through rowToMatchSummary correctly

Each `PlayerMatchRow` returned from the Neon query must be transformed via `rowToMatchSummary` preserving `role`, `damage_to_champions`, `rank`, `rank_queue`, `game_creation`, `game_duration`, and all chart data. The existing test assertions for `role === "MIDDLE"`, `damageToChampions === 24876`, and unavailable-label fallbacks must continue to pass.

**Pass condition:** Existing tests "preserves stored role and damage metadata" and "keeps unavailable labels when stored metadata is genuinely missing" both pass green.
**Evidence:** `npx vitest run lib/database-queries.test.ts` — both `it()` blocks pass.

### VAL-QUERY-003: getPlayerMatchesPaginated returns empty on query error

When the Neon query throws or returns an error, the function must return `{ matches: [], totalCount: 0, hasMore: false }` and log to `console.error`. It must not throw.

**Pass condition:** Mocking the Neon `sql` call to reject verifies the function returns the empty fallback and does not propagate the exception.
**Evidence:** Unit test with error mock; no unhandled rejection.

---

## database-queries.ts — Upserts

### VAL-QUERY-004: upsertPlayerMatch performs ON CONFLICT (match_id, puuid) upsert

`upsertPlayerMatch(row)` must issue an `INSERT ... ON CONFLICT (match_id, puuid) DO UPDATE` query against `player_matches`. It must return `null` on success and the error message string on failure.

**Pass condition:** Calling twice with the same `match_id + puuid` but different `your_impact` values results in only one row with the latest value. A simulated error returns a non-null string.
**Evidence:** Unit test with Neon mock; integration query if available.

### VAL-QUERY-005: upsertPlayerMatchBatch handles batch upserts and empty arrays

`upsertPlayerMatchBatch([])` must return `null` immediately without issuing a query. For a non-empty array, it must upsert all rows in a single query with `ON CONFLICT (match_id, puuid)`.

**Pass condition:** Empty array returns `null` with zero DB calls. Array of 3 rows results in 3 rows present in `player_matches`.
**Evidence:** Unit test; mock call count verification.

### VAL-QUERY-006: upsertPlayerSyncMetadata performs ON CONFLICT (puuid) upsert

`upsertPlayerSyncMetadata(row)` must issue `INSERT ... ON CONFLICT (puuid) DO UPDATE` against `player_sync_metadata`. Returns `null` on success, error string on failure. All fields including `notes` (JSONB) must round-trip correctly.

**Pass condition:** Upserting metadata with a nested `notes.perMatchDerivationVersions` object and then reading it back via `getPlayerSyncMetadata` returns the identical structure.
**Evidence:** Unit test.

---

## database-queries.ts — Single-row & Filtered Reads

### VAL-QUERY-007: getPlayerSyncMetadata returns single row or null

`getPlayerSyncMetadata(puuid)` must query `player_sync_metadata` with `.eq("puuid", puuid)` and return a single row or `null` (equivalent to Supabase `.maybeSingle()`). It must not throw on zero rows.

**Pass condition:** Returns `null` for non-existent puuid. Returns a `PlayerSyncMetadataRow` for an existing puuid.
**Evidence:** Unit test with mock returning `{ data: null }` and `{ data: {...} }`.

### VAL-QUERY-008: getPlayerMatchRowsForStaleCheck returns filtered rows by puuid and match_id IN list

`getPlayerMatchRowsForStaleCheck(puuid, matchIds)` must query `player_matches` selecting `match_id, game_creation, game_duration, created_at` filtered by `puuid` and `match_id IN (...)`. Empty `matchIds` array must return `[]` without issuing a query.

**Pass condition:** With 5 match IDs, only the 3 that exist for the given puuid are returned. Empty input returns `[]` with zero DB calls.
**Evidence:** Unit test; mock call count for empty case.

### VAL-QUERY-009: getAllStoredMatchIds returns ordered match IDs

`getAllStoredMatchIds(puuid)` must return `string[]` of match IDs ordered by `game_creation DESC`. On error, returns `[]`.

**Pass condition:** Returns IDs in newest-first order. Error case returns empty array.
**Evidence:** Unit test.

### VAL-QUERY-010: getImpactCategoriesForUser returns all non-remake impact categories

`getImpactCategoriesForUser(puuid)` must query `player_matches` filtering `puuid` and `is_remake = false`, selecting only `impact_category`. Returns `ImpactCategory[]`.

**Pass condition:** For a player with 10 matches (2 remakes), returns exactly 8 impact category strings.
**Evidence:** Unit test.

### VAL-QUERY-011: getRecentImpactCategories applies limit and ordering

`getRecentImpactCategories(puuid, limit)` must order by `game_creation DESC`, filter `is_remake = false`, and apply `LIMIT`. Default limit is 10.

**Pass condition:** With 20 non-remake matches, `getRecentImpactCategories(puuid, 5)` returns exactly 5 categories from the most recent matches.
**Evidence:** Unit test.

---

## database-queries.ts — Match Cache & Legacy Reads

### VAL-QUERY-012: getMatchCacheEntry returns match and timeline data or nulls

`getMatchCacheEntry(matchId)` must query `match_cache` for `match_data` and `timeline_data` by `match_id`, using a single-row fetch (equivalent to `.maybeSingle()`). Returns `{ matchData, timelineData }` with nulls for missing entries.

**Pass condition:** Existing match returns both objects. Missing match returns `{ matchData: null, timelineData: null }`. Error returns nulls (no throw).
**Evidence:** Unit test.

### VAL-QUERY-013: getMatchDetailsData falls back through cache layers

`getMatchDetailsData(matchId, puuid)` must first check `match_cache`, then fall back to `match_details` (legacy), then return an unavailable response. The `source` field in the result must reflect which layer provided data: `"match_cache"`, `"legacy_cache"`, or unavailable.

**Pass condition:** Three test scenarios: cache hit returns `source: "match_cache"`, legacy hit returns `source: "legacy_cache"`, no data returns unavailable status.
**Evidence:** Unit test.

### VAL-QUERY-014: getStoredMatchDetails and getStoredMatchTimelines return Maps from legacy tables

`getStoredMatchDetails(matchIds)` must query `match_details` with `match_id IN (...)` and return `Map<string, MatchDto>`. `getStoredMatchTimelines(matchIds)` must query `match_timelines` similarly. Both must return empty Maps for empty input and on error.

**Pass condition:** Calling with `["NA1_1", "NA1_2"]` where only `NA1_1` exists returns a Map of size 1. Empty input returns empty Map without DB call.
**Evidence:** Unit test.

---

## riot-api-service.ts — Account Caching

### VAL-QUERY-015: getAccountByRiotId checks Neon cache with case-insensitive lookup

The cache lookup must perform case-insensitive matching on `game_name` and `tag_line` (equivalent to Supabase `.ilike()`). The Neon query must use `ILIKE` or `LOWER()` comparison. On cache hit, no Riot API call is made.

**Pass condition:** Existing test "returns a cached summonerId unchanged when the account row already has one" passes. `fetch` mock is never called.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts` — test passes.

### VAL-QUERY-016: getAccountByRiotId upserts account after Riot API fetch

After a cache miss and successful Riot API fetch, the function must upsert into `accounts` table with `ON CONFLICT (puuid)`, writing `puuid, game_name, tag_line, summoner_id`.

**Pass condition:** Existing test "hydrates a missing summonerId from the worker by puuid before caching" passes. The upsert mock is called with the correct fields.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts` — test passes.

### VAL-QUERY-017: getCachedSummonerIdByPuuid reads from accounts table

Internal helper must query `accounts` for `summoner_id` where `puuid` matches, using single-row fetch. Returns `undefined` when no row or empty value.

**Pass condition:** Existing test "reuses a cached summonerId by puuid before calling the worker summoner lookup" passes.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts`.

### VAL-QUERY-018: getCachedSummonerIdFromMatchParticipants reads player_matches then match_cache

The fallback path must query `player_matches` for up to 25 recent `match_id` values, then query `match_cache` with those IDs, then search `match_data.info.participants` for the puuid's `summonerId`.

**Pass condition:** Existing tests "falls back to match_cache participant summonerId when the worker lookup is forbidden" and "finds cached participant data from older player-specific matches" both pass.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts`.

### VAL-QUERY-019: cacheSummonerIdForPuuid upserts with ON CONFLICT (puuid)

Must upsert `{ puuid, game_name, tag_line, summoner_id }` into `accounts`. If `fallbackAccount` is not provided, must first read existing `game_name, tag_line` to preserve them.

**Pass condition:** The upsert mock receives a complete row with game_name/tag_line preserved from prior cache entries.
**Evidence:** Verified through existing test call assertions on `mockedUpsert`.

---

## riot-api-service.ts — Match Caching

### VAL-QUERY-020: getMatchDetails checks match_details cache then upserts on miss

`getMatchDetails(matchId)` must first query `match_details` for cached data. On miss, fetch from Riot API and upsert `{ match_id, match_data }` with `ON CONFLICT (match_id)`.

**Pass condition:** Cache hit returns data without Riot API call. Cache miss triggers fetch and upsert. Upsert failure logs error but does not throw.
**Evidence:** Unit test.

### VAL-QUERY-021: getMatchTimeline checks match_timelines cache then upserts on miss

`getMatchTimeline(matchId)` must first query `match_timelines` for cached data. On miss, fetch from Riot API and upsert `{ match_id, timeline_data }` with `ON CONFLICT (match_id)`.

**Pass condition:** Same pattern as VAL-QUERY-020 but for timeline data.
**Evidence:** Unit test.

---

## API Routes — Direct Supabase Calls Migrated to Neon

### VAL-QUERY-022: POST /api/backfill reads impact_categories, match_details, match_timelines, match_cache with pagination

The backfill route must read from `impact_categories` with `.range()` pagination, then batch-load from `match_details`, `match_timelines`, and `match_cache` using `IN` clauses in chunks of 50. All three table reads must use the Neon driver.

**Pass condition:** Route returns `200` with `{ backfilled, skipped, ... }` JSON. The `match_details`, `match_timelines`, and `match_cache` queries all execute through Neon.
**Evidence:** Integration test or manual verification with Neon connection.

### VAL-QUERY-023: POST /api/backfill enforces BACKFILL_SECRET header

Missing or incorrect `x-backfill-secret` header must return `401 Unauthorized`.

**Pass condition:** Request without header returns `{ error: "Unauthorized" }` with status 401.
**Evidence:** Unit test or curl test.

### VAL-QUERY-024: GET /api/match-performance reads match_cache then writes match_cache and player_matches

The route must call `getMatchCacheEntry`, and on cache miss call `getMatchDetails`/`getMatchTimeline`. After reconstruction, it must upsert into `player_matches` via `upsertPlayerMatch` and into `match_cache` via direct Neon query with `ON CONFLICT (match_id)`.

**Pass condition:** Existing test "surfaces sync metadata persistence failures in the response body" passes. Cache write uses Neon driver.
**Evidence:** `npx vitest run app/api/match-performance/route.test.ts`.

### VAL-QUERY-025: GET /api/match-performance updates player_sync_metadata

After match persistence, the route must call `upsertPlayerSyncMetadata` with updated tracking fields (`latest_db_match_id`, `latest_riot_match_created_at`, `derivation_version`, `notes` JSONB).

**Pass condition:** `syncMetadataPersistError` is surfaced in the response body when the upsert fails (existing test). On success, no error key is present.
**Evidence:** `npx vitest run app/api/match-performance/route.test.ts`.

### VAL-QUERY-026: POST /api/player-matches/existing-ids queries player_matches with puuid and IN clause

The route must query `player_matches` for `match_id` where `puuid = ?` and `match_id IN (?)`. Input match IDs must be validated against `^[A-Z0-9_]+$/i` and capped at 100.

**Pass condition:** Existing tests "filters malformed or empty match IDs" and "returns an empty result when no valid match IDs are provided" both pass.
**Evidence:** `npx vitest run app/api/player-matches/existing-ids/route.test.ts`.

### VAL-QUERY-027: POST /api/player-matches/stale-ids reads player_sync_metadata and match_cache

The route must query `player_sync_metadata` with `.maybeSingle()` equivalent, then bulk-load `match_cache` rows with `IN` clause, then compare `game_creation`/`game_duration` and derivation version to detect stale entries.

**Pass condition:** Existing test "bulk-loads match_cache rows once and flags mismatched matches as stale" passes. `NA1_2` is flagged stale due to `game_creation` mismatch (301 vs 300).
**Evidence:** `npx vitest run app/api/player-matches/stale-ids/route.test.ts`.

### VAL-QUERY-028: GET /api/player-sync-status reads and POST writes player_sync_metadata

GET must call `getPlayerSyncMetadata` and return `{ lastSyncAt }`. POST must read existing metadata, then call `upsertPlayerSyncMetadata` updating `last_riot_sync_at` to current ISO timestamp.

**Pass condition:** GET returns `{ lastSyncAt: null }` for new player. POST returns `{ success: true, lastSyncAt: "<ISO>" }` and subsequent GET returns the same timestamp.
**Evidence:** Unit test or integration test.

### VAL-QUERY-029: GET /api/stored-matches delegates to getPlayerMatchesPaginated

The route must call `getPlayerMatchesPaginated(puuid, limit, offset)` with clamped parameters (`limit` capped at 100, `offset` ≥ 0) and return `{ matches, totalCount, hasMore }`.

**Pass condition:** Route returns 200 with paginated results. `limit=-1` is clamped to 1. `limit=999` is clamped to 100.
**Evidence:** Manual test or unit test with parameter validation checks.

### VAL-QUERY-030: GET /api/impact-categories delegates to getImpactCategoriesForUser or getRecentImpactCategories

Without `limit` param, calls `getImpactCategoriesForUser`. With `limit` param, calls `getRecentImpactCategories` with clamped value (1–500).

**Pass condition:** Route returns 200 with `{ categories: ImpactCategory[] }`.
**Evidence:** Unit test.

### VAL-QUERY-031: GET /api/account checks cache then Riot API via getAccountByRiotId

The route must call `getAccountByRiotId(gameName, tagLine)` which internally queries Neon `accounts` table. Cache hit avoids Riot API call.

**Pass condition:** Existing `riot-api-service.test.ts` tests pass. Route returns account JSON with `puuid`, `gameName`, `tagLine`, `summonerId`, `riotId`, `rankLookupId`.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts`.

---

## Backfill Script

### VAL-QUERY-032: backfill-player-match-role-damage.ts creates its own Neon client

The script must create a standalone database client (not using `getSupabaseServer`) with direct connection credentials. It must read from `player_matches` (filtered by null `role` or `damage_to_champions`), read from `match_cache`, and upsert back to `player_matches` with `ON CONFLICT (match_id, puuid)`.

**Pass condition:** Script compiles with `npx tsc --noEmit scripts/backfill-player-match-role-damage.ts` (or equivalent). Script runs to completion against a test database and updates rows.
**Evidence:** Compilation success; dry-run output.

### VAL-QUERY-033: backfill script respects BACKFILL_BATCH_SIZE and BACKFILL_MAX_BATCHES

Environment variables must control batch size and iteration limit. Default batch size is 250, default max batches is 1.

**Pass condition:** With `BACKFILL_BATCH_SIZE=10 BACKFILL_MAX_BATCHES=2`, script processes at most 20 candidates.
**Evidence:** Console output showing batch counts.

---

## Test Infrastructure

### VAL-QUERY-034: All test files mock Neon instead of Supabase

Every test file that currently mocks `@/lib/supabase-server` or `./supabase-server` must be updated to mock the Neon driver module (e.g., `@/lib/neon-server` or `@neondatabase/serverless`). The mock must support the query patterns used: parameterized queries, single-row returns, array returns, and error simulation.

**Pass condition:** `npx vitest run` passes all 17 test files with zero Supabase import references remaining.
**Evidence:** Full test suite output; `grep -r "supabase" lib/*.test.ts app/**/*.test.ts` returns zero hits (excluding comments/docs).

### VAL-QUERY-035: database-queries.test.ts mocks produce identical behavior

The Neon mocks in `database-queries.test.ts` must replicate the Supabase chained-builder mock pattern — specifically the `.from().select().eq().eq().order().range()` chain must be replaced with equivalent Neon `sql` tagged template mocks that return `{ rows, rowCount }`.

**Pass condition:** Both existing test cases ("preserves stored role and damage metadata" and "keeps unavailable labels") pass with Neon mocks.
**Evidence:** `npx vitest run lib/database-queries.test.ts`.

### VAL-QUERY-036: riot-api-service.test.ts mocks produce identical behavior

All 6 existing tests in `riot-api-service.test.ts` must pass with Neon mocks replacing Supabase mocks. The `mockedFrom`, `mockedSelect`, `mockedUpsert`, `mockedIlike*`, `mockedMaybeSingle`, `mockedIn`, `mockedPlayerMatchesEq/Order/Limit`, and `mockedMatchCacheIn` mocks must be replaced with Neon-equivalent mocks.

**Pass condition:** All 6 tests pass: summonerId hydration, cached summonerId, cached by puuid, match_cache fallback, puuid fallback, hostile puuid, older matches.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts`.

### VAL-QUERY-037: API route test files pass with Neon mocks

All 4 API route test files must pass:
- `app/api/match-performance/route.test.ts` (1 test)
- `app/api/player-matches/existing-ids/route.test.ts` (2 tests)
- `app/api/player-matches/stale-ids/route.test.ts` (1 test)
- `app/api/match-details/route.test.ts` (3 tests)

**Pass condition:** `npx vitest run app/api/` passes all 7 tests.
**Evidence:** Vitest output.

---

## Build & Type Safety

### VAL-QUERY-038: TypeScript type-check passes with zero errors

`npx tsc --noEmit` (or the project's configured typecheck command) must pass with zero errors. All Neon query return types must satisfy the existing TypeScript interfaces (`PlayerMatchRow`, `PlayerSyncMetadataRow`, `PlayerMatchStaleCheckRow`, `MatchDto`, `MatchTimelineDto`, `AccountDto`).

**Pass condition:** Exit code 0 with no type errors.
**Evidence:** `npx tsc --noEmit` output.

### VAL-QUERY-039: Next.js production build succeeds

`npm run build` (or `next build`) must complete successfully. All API routes and lib modules must compile and bundle without import resolution errors for the Neon driver.

**Pass condition:** Build exits with code 0. No "Module not found" or "Cannot find module" errors for `@neondatabase/serverless` or the Neon server module.
**Evidence:** Build log output.

### VAL-QUERY-040: Full test suite passes

`npx vitest run` must pass all test files (currently 17 files). No regressions from the migration.

**Pass condition:** All tests pass. Zero failures, zero errors.
**Evidence:** `npx vitest run` summary output showing pass count matching or exceeding pre-migration count.

---

## SQL Semantics Parity

### VAL-QUERY-041: Neon parameterized queries prevent SQL injection

All user-supplied values (puuid, match_id, game_name, tag_line) must be passed as parameterized query arguments, never interpolated into SQL strings. This maintains the same injection safety that Supabase's `.eq()`, `.in()`, and `.ilike()` methods provided.

**Pass condition:** Existing hostile-puuid test "does not interpolate hostile puuids into a PostgREST JSON filter" passes with Neon mocks. Code review confirms no string concatenation of user input into SQL.
**Evidence:** `npx vitest run lib/riot-api-service.test.ts` — hostile puuid test passes. Manual code review.

### VAL-QUERY-042: JSONB columns (chart_data, match_data, timeline_data, notes) round-trip correctly

The Neon driver must correctly serialize and deserialize JSONB columns. `chart_data` (array of objects), `match_data` (deep MatchDto), `timeline_data` (deep MatchTimelineDto), and `notes` (Record<string, unknown>) must all survive INSERT → SELECT without data loss or type coercion.

**Pass condition:** Inserting a row with complex `chart_data` and reading it back yields `deep.equal` match. `notes.perMatchDerivationVersions` nested object survives round-trip.
**Evidence:** Unit test or integration test with actual JSONB data.

### VAL-QUERY-043: COUNT queries return numeric totalCount

`getPlayerMatchesPaginated` uses `{ count: "exact" }` in Supabase which returns the total count alongside the data. The Neon equivalent must issue a separate `COUNT(*)` query or a window function to provide `totalCount`. The value must be a JavaScript `number`, not a string.

**Pass condition:** `typeof result.totalCount === "number"` for all calls. Value matches actual row count.
**Evidence:** Unit test assertion on type and value.

### VAL-QUERY-044: .maybeSingle() equivalents return null for zero rows (not throw)

Supabase `.maybeSingle()` returns `{ data: null }` for zero rows. The Neon equivalent must check `rows.length === 0` and return `null`, not throw. Used by: `getPlayerSyncMetadata`, `getMatchCacheEntry`, `getCachedSummonerIdByPuuid`, `cacheSummonerIdForPuuid` (existing account check), and `getAccountByRiotId` cache lookup.

**Pass condition:** All five functions return null/undefined gracefully for missing rows.
**Evidence:** Unit tests for each function with empty result sets.

### VAL-QUERY-045: .single() equivalents throw or return null for zero rows

Supabase `.single()` returns an error if zero or multiple rows are found. Used by: `getAccountByRiotId` (initial cache check — expects exactly one match), `getMatchDetails`, `getMatchTimeline`. The Neon equivalent must handle this: either return null to trigger the Riot API fallback, or match the existing error-handling behavior.

**Pass condition:** Cache miss correctly triggers the Riot API fetch path. Multiple matching rows do not cause ambiguous results.
**Evidence:** Unit test verifying fallback-to-fetch behavior on cache miss.
