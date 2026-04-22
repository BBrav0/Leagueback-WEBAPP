---
name: migration-worker
description: Handles repo markdown, developer workflow, validation-command, and platform-truthfulness features for the Leagueback web mission.
---

# Migration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for all Supabase-to-Neon migration features: schema creation, client module creation, query rewrites, test mock updates, dependency changes, config file updates, and documentation updates.

## Required Skills

None — this worker uses standard file editing tools, shell commands, and the Neon MCP tools when needed for schema operations.

## Work Procedure

1. **Read the feature description** carefully. Understand preconditions, expected behavior, and verification steps.

2. **Read reference materials:**
   - `.factory/research/neon-serverless-driver.md` for the Neon driver API
   - `.factory/library/architecture.md` for migration patterns
   - `AGENTS.md` for coding conventions and boundaries

3. **Read the files you'll modify** to understand current patterns. For query rewrites, read the existing Supabase query to understand its exact semantics (what it selects, filters, orders, error handling).

4. **Write tests first (TDD):**
   - For query migration features: update existing test mocks from Supabase to Neon FIRST
   - The tests should fail initially (because the implementation still uses Supabase)
   - Then update the implementation to make tests pass

5. **Implement the changes:**
   - Follow the migration patterns in `.factory/library/architecture.md`
   - Use SQL template tags: `` sql`SELECT * FROM table WHERE col = ${param}` ``
   - Use `= ANY(${array})` for IN clauses
   - Use `ILIKE` for case-insensitive matching
   - Use `JSON.stringify(obj)::jsonb` for JSONB inserts
   - Use `try/catch` for error handling (NOT `{ data, error }`)
   - Explicitly list ALL columns in upsert SET clauses
   - Preserve exact behavioral semantics of the original code

6. **Run verification commands:**
   - `pnpm test` — all tests must pass
   - `pnpm typecheck` — zero type errors
   - For cleanup milestone: also `pnpm lint` and `pnpm build`

7. **Manual verification:**
   - For schema features: verify tables exist via Neon MCP SQL queries
   - For query features: verify at least one key function works end-to-end
   - For cleanup features: verify no Supabase references remain via grep

## Example Handoff

```json
{
  "salientSummary": "Rewrote all 15 functions in database-queries.ts from Supabase fluent API to Neon parameterized SQL. Updated database-queries.test.ts mocks from Supabase chain builders to Neon sql template tag mocks. All 77 tests pass, typecheck clean.",
  "whatWasImplemented": "Replaced getPlayerMatchesPaginated (now uses COUNT(*) window + LIMIT/OFFSET), upsertPlayerMatch (INSERT ON CONFLICT with explicit SET for all 21 columns), upsertPlayerMatchBatch (single multi-row INSERT), getImpactCategoriesForUser/getRecentImpactCategories (SELECT with is_remake filter), getMatchCacheEntry (single row SELECT), upsertMatchCache (ON CONFLICT match_id), getMatchDetailsData (3-layer cache fallback), getPlayerSyncMetadata/upsertPlayerSyncMetadata (maybeSingle equivalent + ON CONFLICT puuid), getPlayerMatchRowsForStaleCheck (ANY array parameter), getAllStoredMatchIds (ORDER BY game_creation DESC), getStoredMatchDetails/getStoredMatchTimelines (ANY + Map construction). Updated test mocks to return arrays instead of {data, error}.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm test -- lib/database-queries.test.ts", "exitCode": 0, "observation": "2 test files, 4 tests, all passing" },
      { "command": "pnpm test", "exitCode": 0, "observation": "17 files, 77 tests, all passing" },
      { "command": "pnpm typecheck", "exitCode": 0, "observation": "Zero type errors" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "lib/database-queries.test.ts", "cases": [
        { "name": "updated mock pattern for Neon sql template", "verifies": "Neon mock returns rows array instead of {data, error}" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A query pattern doesn't have a clear Neon equivalent (e.g., complex Supabase filter chain)
- Tests fail after migration and the root cause is unclear
- A file has been modified by another worker and conflicts with your changes
- The Neon database is unreachable or the schema is missing expected tables
- Requirements are ambiguous (e.g., unclear whether a function should throw or return null)
