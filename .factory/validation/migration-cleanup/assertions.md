# Validation Contract — Cleanup Area (Supabase Removal)

## Package Dependencies

### VAL-CLEAN-001: `@supabase/supabase-js` removed from dependencies
`package.json` `dependencies` must not contain the key `@supabase/supabase-js`.
**Pass condition:** `grep -c '"@supabase/supabase-js"' package.json` returns 0.
**Evidence:** Run `node -e "const p=require('./package.json'); console.log(p.dependencies['@supabase/supabase-js'])"` — must print `undefined`.

### VAL-CLEAN-002: `supabase` CLI removed from devDependencies
`package.json` `devDependencies` must not contain the key `supabase`.
**Pass condition:** `node -e "const p=require('./package.json'); console.log(p.devDependencies['supabase'])"` prints `undefined`.
**Evidence:** Inspect `package.json` `devDependencies` section; the `"supabase"` entry must be absent.

### VAL-CLEAN-003: Lock file updated after package removal
`pnpm-lock.yaml` must not contain any resolved entry for `@supabase/supabase-js` or the `supabase` CLI package.
**Pass condition:** `grep -c "@supabase/supabase-js" pnpm-lock.yaml` returns 0 AND `pnpm install --frozen-lockfile` succeeds.
**Evidence:** Run `pnpm install --frozen-lockfile` with no errors; grep lock file for supabase references.

## Deleted Files

### VAL-CLEAN-004: `lib/supabase.ts` (anon client) deleted
The file `lib/supabase.ts` must not exist on disk.
**Pass condition:** `test -f lib/supabase.ts` returns exit code 1 (file not found).
**Evidence:** `ls lib/supabase.ts` fails or glob `lib/supabase.ts` returns empty.

### VAL-CLEAN-005: `lib/supabase-server.ts` (server client) deleted
The file `lib/supabase-server.ts` must not exist on disk.
**Pass condition:** `test -f lib/supabase-server.ts` returns exit code 1 (file not found).
**Evidence:** `ls lib/supabase-server.ts` fails or glob `lib/supabase-server.ts` returns empty.

### VAL-CLEAN-006: `.github/workflows/supabase-keep-awake.yml` deleted
The keep-awake workflow file must not exist.
**Pass condition:** `test -f .github/workflows/supabase-keep-awake.yml` returns exit code 1.
**Evidence:** `ls .github/workflows/supabase-keep-awake.yml` fails or glob returns empty.

## No Remaining Supabase Imports

### VAL-CLEAN-007: No source file imports `@supabase/supabase-js`
No `.ts`, `.tsx`, `.js`, `.jsx`, or `.mjs` file anywhere in the project (excluding `node_modules/`, `.next/`, `.open-next/`, `.wrangler/`) may contain an import or require of `@supabase/supabase-js`.
**Pass condition:** `rg -l "@supabase/supabase-js" --glob "*.{ts,tsx,js,jsx,mjs}" --glob "!node_modules/**" --glob "!.next/**" --glob "!.open-next/**" --glob "!.wrangler/**"` returns no results.
**Evidence:** Ripgrep or equivalent search across all source files returns zero matches.

### VAL-CLEAN-008: No source file imports from `supabase-server` or `supabase` local modules
No source or test file may contain `from "./supabase-server"`, `from "@/lib/supabase-server"`, `from "./supabase"`, or `from "@/lib/supabase"`.
**Pass condition:** `rg -l "from [\"'](\./|@/lib/)supabase(-server)?[\"']" --glob "*.{ts,tsx}" --glob "!node_modules/**" --glob "!.next/**"` returns no results.
**Evidence:** Ripgrep across all `.ts`/`.tsx` files returns zero matches for local supabase module imports.

### VAL-CLEAN-009: No test file mocks Supabase modules
No test file may contain `vi.mock(...)` targeting `supabase-server` or `supabase` modules. These mocks exist in: `lib/riot-api-service.test.ts`, `lib/database-queries.test.ts`, `app/api/player-matches/stale-ids/route.test.ts`, `app/api/player-matches/existing-ids/route.test.ts`, `app/api/match-performance/route.test.ts`.
**Pass condition:** `rg -l "vi\.mock.*supabase" --glob "*.test.{ts,tsx}"` returns no results.
**Evidence:** Grep all test files for `vi.mock` referencing supabase — zero matches.

### VAL-CLEAN-010: No remaining string references to Supabase env vars in source
No source file (excluding `CLAUDE.md`, `.factory/`, `README.md`, `ROADMAP.md`) should reference `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variable lookups or error messages. Note: `components/dashboard/lol-stats-dashboard.tsx` line 941 currently contains an error message string mentioning `SUPABASE_SERVICE_ROLE_KEY`.
**Pass condition:** `rg -l "SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)|NEXT_PUBLIC_SUPABASE" --glob "*.{ts,tsx,js,jsx,mjs}" --glob "!node_modules/**" --glob "!.next/**" --glob "!.open-next/**"` returns no results.
**Evidence:** Ripgrep for Supabase env var names across all source files returns zero matches.

## Configuration Files Updated

### VAL-CLEAN-011: `.env.example` contains `DATABASE_URL` and no Supabase vars
`.env.example` must:
1. NOT contain any of: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
2. CONTAIN a `DATABASE_URL` entry with placeholder value
3. Still contain `BACKFILL_SECRET` and `RIOT_API_KEY`
**Pass condition:** `grep -c SUPABASE .env.example` returns 0 AND `grep -c DATABASE_URL .env.example` returns ≥1.
**Evidence:** Read `.env.example` and verify it has `DATABASE_URL=...` placeholder and zero lines with `SUPABASE`.

### VAL-CLEAN-012: `wrangler.jsonc` env var comments updated
The comment block at the end of `wrangler.jsonc` (currently lines referencing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) must be updated to reference `DATABASE_URL` instead of Supabase-specific variables.
**Pass condition:** `grep -ci supabase wrangler.jsonc` returns 0 AND `grep -c DATABASE_URL wrangler.jsonc` returns ≥1.
**Evidence:** Read `wrangler.jsonc` and confirm Supabase references are replaced with Neon/DATABASE_URL references.

## ESLint

### VAL-CLEAN-013: `.open-next/**` added to ESLint ignores
`eslint.config.mjs` ignores array must include `".open-next/**"` to prevent lint errors from generated Cloudflare build artifacts.
**Pass condition:** `grep -c '.open-next' eslint.config.mjs` returns ≥1.
**Evidence:** Read `eslint.config.mjs` and confirm `".open-next/**"` is present in the `ignores` array.

### VAL-CLEAN-014: ESLint passes clean
`pnpm run lint` must exit with code 0 and produce zero warnings (the project uses `--max-warnings=0`).
**Pass condition:** `pnpm run lint` exits 0 with no error or warning output.
**Evidence:** Full lint output captured showing clean pass.

## Build and Type Safety

### VAL-CLEAN-015: TypeScript type-check passes
`pnpm run typecheck` (which runs `tsc --noEmit`) must exit with code 0 and zero errors.
**Pass condition:** `pnpm run typecheck` exits 0.
**Evidence:** Full typecheck output captured showing zero errors.

### VAL-CLEAN-016: Next.js build passes
`pnpm run build` must exit with code 0. The build must not contain any import resolution errors for deleted supabase modules.
**Pass condition:** `pnpm run build` exits 0 with no module-not-found errors.
**Evidence:** Build log captured showing successful completion.

### VAL-CLEAN-017: Test suite passes
`pnpm run test` (Vitest) must exit with code 0 with all tests passing. No test may fail due to missing supabase mocks or modules.
**Pass condition:** `pnpm run test` exits 0.
**Evidence:** Test output captured showing all suites pass.

## Documentation

### VAL-CLEAN-018: `CLAUDE.md` reflects Neon stack
`CLAUDE.md` must:
1. Reference Neon (not Supabase) as the database provider in the Stack section
2. List `DATABASE_URL` in the environment variables section (not Supabase vars)
3. Update the Data Flow section to remove Supabase-specific references
4. Update the Database Tables section to remove RLS/anon-role/service-role Supabase-specific language
5. Update the Security section (S4, S5) to remove Supabase cache write references
6. Remove or update the "What Works Well" section items that reference Supabase (parameterized filters, `server-only` import, RLS migration)
**Pass condition:** `grep -ci supabase CLAUDE.md` returns 0 (no Supabase references remain) OR all remaining references are purely historical/migration-context notes clearly marked as legacy.
**Evidence:** Read `CLAUDE.md` end-to-end and confirm the stack description, env vars, data flow, and all audit items reflect the Neon-based architecture.
