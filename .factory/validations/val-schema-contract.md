# Validation Contract — Schema & Client Setup

---

### VAL-SCHEMA-001: `accounts` table exists with correct columns and types
The `public.accounts` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `puuid` | `text` | NOT NULL | — (PRIMARY KEY) |
| `game_name` | `text` | NOT NULL | — |
| `tag_line` | `text` | NOT NULL | — |
| `summoner_id` | `text` | NULL | — |
| `created_at` | `timestamptz` | NULL | `now()` |

**Pass:** `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts'` returns exactly these 5 columns with matching types and nullability.
**Fail:** Any column is missing, has a wrong type, or extra unexpected columns exist.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation from `information_schema.table_constraints`.

---

### VAL-SCHEMA-002: `match_details` table exists with correct columns and types
The `public.match_details` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `match_id` | `text` | NOT NULL | — (PRIMARY KEY) |
| `match_data` | `jsonb` | NOT NULL | — |
| `created_at` | `timestamptz` | NULL | `now()` |

**Pass:** All 3 columns exist with correct types.
**Fail:** Any column is missing or has a wrong type.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation.

---

### VAL-SCHEMA-003: `match_timelines` table exists with correct columns and types
The `public.match_timelines` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `match_id` | `text` | NOT NULL | — (PRIMARY KEY) |
| `timeline_data` | `jsonb` | NOT NULL | — |
| `created_at` | `timestamptz` | NULL | `now()` |

**Pass:** All 3 columns exist with correct types.
**Fail:** Any column is missing or has a wrong type.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation.

---

### VAL-SCHEMA-004: `impact_categories` table exists with correct columns and types
The `public.impact_categories` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `match_id` | `text` | NOT NULL | — (composite PK) |
| `puuid` | `text` | NOT NULL | — (composite PK) |
| `category` | `text` | NOT NULL | — |
| `created_at` | `timestamptz` | NULL | `now()` |

Primary key: `(match_id, puuid)`.

**Pass:** All 4 columns exist with correct types; composite primary key on `(match_id, puuid)`.
**Fail:** Any column is missing, wrong type, or PK is incorrect.
**Evidence:** Query result from `information_schema.columns` and `information_schema.table_constraints`.

---

### VAL-SCHEMA-005: `player_matches` table exists with correct columns and types
The `public.player_matches` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `match_id` | `text` | NOT NULL | — (composite PK) |
| `puuid` | `text` | NOT NULL | — (composite PK) |
| `champion` | `text` | NOT NULL | — |
| `kda` | `text` | NOT NULL | — |
| `cs` | `integer` | NOT NULL | `0` |
| `vision_score` | `integer` | NOT NULL | `0` |
| `game_result` | `text` | NOT NULL | — |
| `game_time` | `text` | NOT NULL | — |
| `your_impact` | `double precision` | NOT NULL | `0` |
| `team_impact` | `double precision` | NOT NULL | `0` |
| `impact_category` | `text` | NOT NULL | — |
| `chart_data` | `jsonb` | NOT NULL | `'[]'::jsonb` |
| `game_creation` | `bigint` | NOT NULL | `0` |
| `game_duration` | `integer` | NOT NULL | `0` |
| `created_at` | `timestamptz` | NULL | `now()` |
| `summoner_name` | `text` | NOT NULL | `''` |
| `role` | `text` | NULL | — |
| `damage_to_champions` | `integer` | NULL | — |
| `rank` | `text` | NULL | — |
| `rank_queue` | `text` | NULL | — |
| `is_remake` | `boolean` | NOT NULL | `false` |

Primary key: `(match_id, puuid)`.

**Pass:** All 21 columns exist with correct types and nullability; composite PK on `(match_id, puuid)`.
**Fail:** Any column is missing, has wrong type, or PK is incorrect.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation.

---

### VAL-SCHEMA-006: `match_cache` table exists with correct columns and types
The `public.match_cache` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `match_id` | `text` | NOT NULL | — (PRIMARY KEY) |
| `match_data` | `jsonb` | NOT NULL | — |
| `timeline_data` | `jsonb` | NOT NULL | — |
| `cached_at` | `timestamptz` | NULL | `now()` |

**Pass:** All 4 columns exist with correct types.
**Fail:** Any column is missing or has a wrong type.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation.

---

### VAL-SCHEMA-007: `player_sync_metadata` table exists with correct columns and types
The `public.player_sync_metadata` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `puuid` | `text` | NOT NULL | — (PRIMARY KEY) |
| `latest_riot_match_id` | `text` | NULL | — |
| `latest_riot_match_created_at` | `bigint` | NULL | — |
| `latest_db_match_id` | `text` | NULL | — |
| `latest_db_match_created_at` | `bigint` | NULL | — |
| `recent_match_window` | `integer` | NOT NULL | `25` |
| `reconciled_through_match_created_at` | `bigint` | NULL | — |
| `last_riot_sync_at` | `timestamptz` | NULL | — |
| `last_full_refresh_at` | `timestamptz` | NULL | — |
| `last_stale_derived_refresh_at` | `timestamptz` | NULL | — |
| `last_known_account_game_name` | `text` | NULL | — |
| `last_known_account_tag_line` | `text` | NULL | — |
| `derivation_version` | `text` | NULL | — |
| `notes` | `jsonb` | NOT NULL | `'{}'::jsonb` |
| `created_at` | `timestamptz` | NOT NULL | `now()` |
| `updated_at` | `timestamptz` | NOT NULL | `now()` |

**Pass:** All 16 columns exist with correct types and nullability.
**Fail:** Any column is missing, has wrong type, or has wrong nullability.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation.

---

### VAL-SCHEMA-008: `keepalive` table exists with correct columns and types
The `public.keepalive` table must exist in Neon with the following columns:
| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `integer` | NOT NULL | — (PRIMARY KEY) |
| `pinged_at` | `timestamptz` | NULL | — |

**Pass:** Both columns exist with correct types; PK on `id`.
**Fail:** Table is missing or has wrong column definitions.
**Evidence:** Query result from `information_schema.columns`; primary key confirmation.

---

### VAL-SCHEMA-009: Index `idx_accounts_game_tag` exists on `accounts`
Index `idx_accounts_game_tag` must exist on `public.accounts` covering columns `(game_name, tag_line)`.

**Pass:** `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='accounts' AND indexname='idx_accounts_game_tag'` returns one row, and `indexdef` references `(game_name, tag_line)`.
**Fail:** Index is missing or covers wrong columns.
**Evidence:** Query result from `pg_indexes`.

---

### VAL-SCHEMA-010: Index `idx_impact_puuid` exists on `impact_categories`
Index `idx_impact_puuid` must exist on `public.impact_categories` covering column `(puuid)`.

**Pass:** `pg_indexes` query returns one row for `idx_impact_puuid` referencing `(puuid)`.
**Fail:** Index is missing or covers wrong columns.
**Evidence:** Query result from `pg_indexes`.

---

### VAL-SCHEMA-011: Index `idx_player_matches_puuid_game` exists on `player_matches`
Index `idx_player_matches_puuid_game` must exist on `public.player_matches` covering columns `(puuid, game_creation DESC)`.

**Pass:** `pg_indexes` query returns one row for `idx_player_matches_puuid_game` referencing `(puuid, game_creation DESC)`.
**Fail:** Index is missing or covers wrong columns/ordering.
**Evidence:** Query result from `pg_indexes` showing the `indexdef`.

---

### VAL-SCHEMA-012: Index `idx_player_matches_puuid_category` exists on `player_matches`
Index `idx_player_matches_puuid_category` must exist on `public.player_matches` covering columns `(puuid, impact_category)`.

**Pass:** `pg_indexes` query returns one row for `idx_player_matches_puuid_category`.
**Fail:** Index is missing or covers wrong columns.
**Evidence:** Query result from `pg_indexes`.

---

### VAL-SCHEMA-013: Index `idx_player_sync_metadata_last_riot_sync` exists on `player_sync_metadata`
Index `idx_player_sync_metadata_last_riot_sync` must exist on `public.player_sync_metadata` covering column `(last_riot_sync_at DESC NULLS LAST)`.

**Pass:** `pg_indexes` query returns one row for this index with matching `indexdef`.
**Fail:** Index is missing or covers wrong columns/ordering.
**Evidence:** Query result from `pg_indexes`.

---

### VAL-SCHEMA-014: Index `idx_player_sync_metadata_latest_db_match_created` exists on `player_sync_metadata`
Index `idx_player_sync_metadata_latest_db_match_created` must exist on `public.player_sync_metadata` covering column `(latest_db_match_created_at DESC NULLS LAST)`.

**Pass:** `pg_indexes` query returns one row for this index with matching `indexdef`.
**Fail:** Index is missing or covers wrong columns/ordering.
**Evidence:** Query result from `pg_indexes`.

---

### VAL-SCHEMA-015: Trigger function `set_player_sync_metadata_updated_at` auto-sets `updated_at`
The function `public.set_player_sync_metadata_updated_at()` must exist and be wired as a `BEFORE UPDATE` trigger on `player_sync_metadata`. When a row is updated, `updated_at` must automatically change to `now()` without explicit SET in the UPDATE statement.

**Pass:**
1. `SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name='set_player_sync_metadata_updated_at'` returns one row.
2. `SELECT trigger_name, event_manipulation, action_timing FROM information_schema.triggers WHERE event_object_table='player_sync_metadata' AND trigger_name='set_player_sync_metadata_updated_at'` returns one row with `event_manipulation='UPDATE'` and `action_timing='BEFORE'`.
3. Insert a test row: `INSERT INTO player_sync_metadata (puuid) VALUES ('test-trigger-puuid')`. Record `updated_at`.
4. After a ≥1 second pause, execute: `UPDATE player_sync_metadata SET latest_riot_match_id='test' WHERE puuid='test-trigger-puuid'`.
5. Re-query `updated_at` — it must be strictly later than the originally recorded value.
6. Clean up: `DELETE FROM player_sync_metadata WHERE puuid='test-trigger-puuid'`.

**Fail:** Trigger/function does not exist, or `updated_at` is not automatically updated on UPDATE.
**Evidence:** Query results from steps 1–5 above.

---

### VAL-SCHEMA-016: CHECK constraint on `impact_categories.category` enforces valid values
The column `impact_categories.category` must only accept values in `('impactWins', 'impactLosses', 'guaranteedWins', 'guaranteedLosses')`.

**Pass:**
1. `INSERT INTO impact_categories (match_id, puuid, category) VALUES ('CHK-TEST-1', 'chk-puuid', 'impactWins')` succeeds.
2. `INSERT INTO impact_categories (match_id, puuid, category) VALUES ('CHK-TEST-2', 'chk-puuid', 'invalidValue')` is rejected with a CHECK constraint violation.
3. Clean up: `DELETE FROM impact_categories WHERE puuid='chk-puuid'`.

**Fail:** The invalid value is accepted, or the valid value is rejected.
**Evidence:** Success/error messages from the two INSERT statements.

---

### VAL-SCHEMA-017: CHECK constraint on `player_matches.game_result` enforces valid values
The column `player_matches.game_result` must only accept values in `('Victory', 'Defeat')`.

**Pass:**
1. Insert a valid row with `game_result='Victory'` — succeeds.
2. Insert a row with `game_result='Draw'` — rejected with a CHECK constraint violation.
3. Clean up test rows.

**Fail:** The invalid value is accepted, or the valid value is rejected.
**Evidence:** Success/error messages from INSERT attempts.

---

### VAL-SCHEMA-018: CHECK constraint on `player_matches.impact_category` enforces valid values
The column `player_matches.impact_category` must only accept values in `('impactWins', 'impactLosses', 'guaranteedWins', 'guaranteedLosses')`.

**Pass:**
1. Insert a valid row with `impact_category='guaranteedWins'` — succeeds.
2. Insert a row with `impact_category='neutral'` — rejected with a CHECK constraint violation.
3. Clean up test rows.

**Fail:** The invalid value is accepted, or the valid value is rejected.
**Evidence:** Success/error messages from INSERT attempts.

---

### VAL-SCHEMA-019: CHECK constraint on `player_matches.rank_queue` enforces valid values
The column `player_matches.rank_queue` must only accept values in `('RANKED_SOLO_5x5', 'RANKED_FLEX_SR')` or NULL.

**Pass:**
1. Insert a valid row with `rank_queue='RANKED_SOLO_5x5'` — succeeds.
2. Insert a valid row with `rank_queue=NULL` — succeeds.
3. Insert a row with `rank_queue='ARAM'` — rejected with a CHECK constraint violation.
4. Clean up test rows.

**Fail:** The invalid value is accepted.
**Evidence:** Success/error messages from INSERT attempts.

---

### VAL-SCHEMA-020: CHECK constraint on `player_sync_metadata.recent_match_window` enforces > 0
The column `player_sync_metadata.recent_match_window` must reject values ≤ 0.

**Pass:**
1. Insert a row with `recent_match_window=25` — succeeds (default or explicit).
2. Insert/update a row with `recent_match_window=0` — rejected with a CHECK constraint violation.
3. Insert/update a row with `recent_match_window=-1` — rejected with a CHECK constraint violation.
4. Clean up test rows.

**Fail:** A value ≤ 0 is accepted.
**Evidence:** Success/error messages from INSERT/UPDATE attempts.

---

### VAL-SCHEMA-021: Neon client module exports a working connection function
The file `lib/neon.ts` must exist and export a function (e.g., `getDb` or `sql`) that returns a Neon serverless SQL client. The module must use the `@neondatabase/serverless` package.

**Pass:**
1. `lib/neon.ts` file exists in the project.
2. The file imports from `@neondatabase/serverless`.
3. The exported function is callable and returns a connection object capable of executing SQL.
4. TypeScript compilation succeeds with no errors for this module.

**Fail:** File does not exist, does not import `@neondatabase/serverless`, or the exported function is not callable / fails to compile.
**Evidence:** File contents of `lib/neon.ts`; `npx tsc --noEmit` output for the module; import validation.

---

### VAL-SCHEMA-022: Neon client can execute a basic SELECT query
Using the `lib/neon.ts` client, a basic SELECT query must succeed.

**Pass:** Executing `SELECT 1 AS ok` through the Neon client returns a result with `ok = 1`.
**Fail:** The query fails with a connection error, authentication error, or returns unexpected results.
**Evidence:** Query result object showing `{ ok: 1 }` or equivalent.

---

### VAL-SCHEMA-023: Neon client can execute a basic INSERT and retrieve the row
Using the `lib/neon.ts` client, an INSERT into the `keepalive` table followed by a SELECT must succeed.

**Pass:**
1. `INSERT INTO keepalive (id, pinged_at) VALUES (99, now()) ON CONFLICT (id) DO UPDATE SET pinged_at = now()` succeeds.
2. `SELECT * FROM keepalive WHERE id = 99` returns one row with `pinged_at` set.
3. Clean up: `DELETE FROM keepalive WHERE id = 99`.

**Fail:** INSERT fails, SELECT returns no rows, or the returned data is incorrect.
**Evidence:** Successful INSERT confirmation; SELECT result showing the row; DELETE confirmation.

---

### VAL-SCHEMA-024: Neon client can execute a basic UPDATE
Using the `lib/neon.ts` client, an UPDATE on an existing row must succeed and be reflected in subsequent reads.

**Pass:**
1. Insert a test row into `accounts`: `INSERT INTO accounts (puuid, game_name, tag_line) VALUES ('val-test-024', 'TestName', 'NA1')`.
2. Update it: `UPDATE accounts SET game_name = 'UpdatedName' WHERE puuid = 'val-test-024'`.
3. Read it back: `SELECT game_name FROM accounts WHERE puuid = 'val-test-024'` returns `'UpdatedName'`.
4. Clean up: `DELETE FROM accounts WHERE puuid = 'val-test-024'`.

**Fail:** UPDATE does not persist, SELECT returns the old value, or any step errors.
**Evidence:** Query results from each step.

---

### VAL-SCHEMA-025: Environment variable `DATABASE_URL` is consumed by the Neon client
The `lib/neon.ts` module must read the connection string from `process.env.DATABASE_URL` (the Neon standard). It must throw a clear error if `DATABASE_URL` is not set.

**Pass:**
1. Source code of `lib/neon.ts` references `process.env.DATABASE_URL`.
2. When `DATABASE_URL` is unset, calling the exported function throws an error with a message mentioning `DATABASE_URL`.
3. When `DATABASE_URL` is set to a valid Neon connection string, the client connects successfully.

**Fail:** The module uses a different env var name, does not throw when the var is missing, or fails to connect with a valid string.
**Evidence:** Source code inspection of `lib/neon.ts`; runtime error message when env var is missing; successful connection log when env var is set.

---

### VAL-SCHEMA-026: All 8 tables are present — no missing, no extra
Exactly 8 application tables must exist in the `public` schema: `accounts`, `match_details`, `match_timelines`, `impact_categories`, `player_matches`, `match_cache`, `player_sync_metadata`, `keepalive`.

**Pass:** `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name` returns exactly these 8 table names (no more, no fewer).
**Fail:** Any table is missing or unexpected tables are present.
**Evidence:** Full query result listing all public tables.

---

### VAL-SCHEMA-027: All 6 custom indexes are present
Exactly 6 custom (non-primary-key) indexes must exist:
1. `idx_accounts_game_tag`
2. `idx_impact_puuid`
3. `idx_player_matches_puuid_game`
4. `idx_player_matches_puuid_category`
5. `idx_player_sync_metadata_last_riot_sync`
6. `idx_player_sync_metadata_latest_db_match_created`

**Pass:** `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'` returns at least these 6 indexes.
**Fail:** Any of the 6 indexes is missing.
**Evidence:** Full query result from `pg_indexes`.
