# CLAUDE.md — Leagueback WEBAPP

## Project Overview

**Purpose:** League of Legends ranked match analysis tool. Players look up their Riot ID and see their match history with an "impact score" that measures their contribution relative to team average.

**Stack:**
- Next.js 16 (App Router) + React 18 + TypeScript
- Supabase (PostgreSQL) for caching and precomputed match data
- Cloudflare Worker (`worker/`) as a Riot API proxy (holds the API key; rate-limits by IP)
- Tailwind CSS + Radix UI (shadcn/ui components in `components/ui/`)
- Vercel for hosting; Vitest for tests

**Key environment variables (none committed — set locally and in Vercel/GitHub):**
```
SUPABASE_URL
SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # server-only; bypasses RLS
BACKFILL_SECRET             # header secret for /api/backfill
RIOT_PROXY_URL              # defaults to https://riot-proxy.riot-proxy.workers.dev
```

### Data Flow
1. User submits a Riot ID → frontend calls `/api/account` → cached in `accounts` table or proxied through Worker to Riot API
2. Frontend calls `/api/match-history` (fresh fetch from Riot via Worker, not cached)
3. For each match, frontend calls `/api/match-performance` → checks `match_cache`, fetches from Worker if cold, stores in `match_cache` and `player_matches`
4. Paginated DB results served from `player_matches` via `/api/stored-matches`
5. Impact category stats served from `/api/impact-categories`

### Database Tables
| Table | Purpose |
|---|---|
| `accounts` | Riot account cache (puuid, game_name, tag_line) |
| `match_cache` | Combined match + timeline JSON cache |
| `match_details` | Legacy raw match JSON (superseded by match_cache) |
| `match_timelines` | Legacy raw timeline JSON (superseded by match_cache) |
| `player_matches` | Precomputed summaries (champion, KDA, impact scores, etc.) |
| `impact_categories` | (DB table, data read from player_matches in practice) |

RLS is enabled on all tables. Anon role: SELECT only. Service role (server-side): full write access.

---

## Codebase Audit

### Security

**S1 — Missing HTTP status codes on several `match-performance` error paths** ✅ Fixed
`app/api/match-performance/route.ts` lines 33–55 and 107–110: validation failures (missing match details, user not found in match, missing timeline) return `NextResponse.json(...)` **without a `{ status }` option**, so they return HTTP 200 instead of 4xx. The catch block at line 107 also omits a status code.

```typescript
// line 33 — returns 200
return NextResponse.json({ success: false, error: "Could not retrieve match details." });
// fix: add { status: 400 } (or 404)

// line 107 — returns 200
return NextResponse.json({ success: false, error: ... });
// fix: add { status: 500 }
```

**S2 — ESLint and TypeScript build errors silently suppressed** ✅ Fixed
`next.config.mjs`: Both `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors` flags have been removed. TypeScript now runs clean with zero errors on every build.

**S3 — Rate limiter is client-side only and bypassable** (open — server-side rate limiting requires new infrastructure)
`lib/rate-limiter.ts`: The entire implementation uses `sessionStorage`. Any user can clear storage, use a private window, or use a non-browser client to bypass it entirely. The Worker already applies per-IP rate limiting (60 req/min), which is the real server-side guard, but the Next.js API routes themselves have no server-side rate limiting.

**S4 — Silent cache write failures in riot-api-service.ts** ✅ Fixed
`lib/riot-api-service.ts` lines 63–69, 114–116, 146–148: Supabase `.upsert()` results are awaited but return values are discarded — errors are never checked. If a cache write fails (quota, RLS mismatch, network), the app continues silently with no log.

```typescript
// line 63 — error discarded
await getSupabaseServer().from("accounts").upsert({ ... });
// fix: const { error } = await ...; if (error) console.error(...)
```

**S5 — No `.env.example` file** ✅ Fixed
No `.env.example` or `.env.local.example` exists. New contributors (or new deployments) have no reference for which variables are required. The full list is documented above in this file.

**S6 — Worker CORS allows all origins**
`worker/src/index.ts`: CORS headers set `Access-Control-Allow-Origin: *`. Acceptable for public Riot data, but note that this means any site can proxy requests through your Worker and consume your rate limit quota.

---

### Code Quality / Dead Code

**Q1 — `loadImpactCache` / `saveImpactCache` / `IMPACT_CACHE_KEY` are dead code** ✅ Fixed (removed)
`components/dashboard/lol-stats-dashboard.tsx` lines 60–101: These three items are defined but never called anywhere in the file or the rest of the codebase. The localStorage cache was likely planned but not wired up. Should be removed.

**Q2 — Unchecked type cast in `database-queries.ts`**
`lib/database-queries.ts` line 61:
```typescript
const matches = (data as PlayerMatchRow[]).map(rowToMatchSummary);
```
`data` from Supabase `.select("*")` is typed as `any[]` when no generic is provided. The cast is safe in practice (Supabase returns the correct shape) but bypasses type checking. The preceding error check (line 56) means `data` won't be null here, but it could still be `null` if the query returns no rows — Supabase returns `[]` not `null` for `.select()` without `.single()`, so this is fine in practice but fragile.

**Q3 — No bounds validation on `limit`/`offset` in three routes** ✅ Fixed
- `app/api/stored-matches/route.ts` lines 17–18
- `app/api/impact-categories/route.ts` line 19

Both parse `limit` and `offset` from query params with no bounds checking. A caller could pass `limit=-1`, `limit=0`, or `limit=999999`. Contrast with `app/api/backfill/route.ts` which properly clamps: `Math.min(Math.max(..., 1), 1000)`.

**Q4 — Match ID format is never validated**
`app/api/player-matches/existing-ids/route.ts` lines 19–21: match IDs are filtered to non-empty strings but otherwise accepted as-is. Riot match IDs follow a format like `NA1_1234567890`. No format check is enforced before passing to `.in("match_id", matchIds)`.

---

### Potential Runtime Errors

**R1 — `match-performance` catch block returns HTTP 200** ✅ Fixed (now returns 500)

**R2 — `Promise.all` in `match-performance` has no partial failure handling**
`app/api/match-performance/route.ts` line 28–31:
```typescript
await Promise.all([getMatchDetails(matchId), getMatchTimeline(matchId)])
```
If either fetch fails, the entire call rejects and falls to the catch block (which returns HTTP 200 per R1). There is no way to tell the caller which part failed. Not a correctness bug per se, but makes debugging harder.

**R3 — 16 independent state variables in the dashboard component**
`components/dashboard/lol-stats-dashboard.tsx` lines 339–367: The component manages 16+ separate `useState` calls for related pieces of state (`hasMoreDbMatches` and `allDbMatchesLoaded` are effectively inverses of each other). Concurrent state updates across these variables can transiently produce inconsistent UI (e.g., showing both "loading" and "no more results" simultaneously).

**R4 — `loadMoreDbMatches` callback deps cause IntersectionObserver churn**
`lol-stats-dashboard.tsx` around line 749: The infinite scroll observer depends on `loadMoreDbMatches` which is a `useCallback`. That callback includes `loadedDbMatches` in its deps, which changes after every load. This recreates the callback and therefore disconnects/reconnects the IntersectionObserver on every successful load.

---

### Architecture Concerns

**A1 — `lol-stats-dashboard.tsx` is a 1100-line monolith**
The single component handles: URL parsing, rate limiting, API fetching, impact score syncing, infinite scroll, pagination state, chart rendering, match cards, and the search form. This makes it difficult to test, maintain, or reason about independently. Natural split points:
- Custom hook for match fetching + pagination state
- Separate `SearchForm`, `MatchList`, `StatsPanel` components

**A2 — No `middleware.ts`**
There is no Next.js middleware file. Each API route is responsible for its own concerns (auth, logging, etc.). Currently only `/api/backfill` enforces a secret header. All other routes are intentionally public (Riot data is public), but a centralized middleware would be the right place to add logging, request IDs, or future auth if needed.

**A3 — No cache TTL on Supabase tables**
`accounts`, `match_details`, `match_timelines`, and `match_cache` rows are cached indefinitely. If Riot changes match data retroactively, or a player changes their Riot ID, stale data persists forever. None of the cache tables have a `created_at` timestamp used for expiry. (The `accounts` table may be most affected — players can rename themselves on Riot.)

**A4 — Business logic mixed into the dashboard component**
Impact category syncing (`syncImpactStats`), match reconstruction calls, and rate limit checks are inline in the 1100-line component rather than in custom hooks or separate modules. This is already partially addressed — the hard math is in `lib/performance-calculation.ts` and `lib/match-reconstruction.ts` — but the fetching orchestration layer is tightly coupled to the UI.

---

### Dependencies and Config

**D1 — All packages are current (as of 2026-03-27)**
- `next: ^16.1.6`, `react: 18.2.0`, `@supabase/supabase-js: ^2.95.3`
- `wrangler: ^4.65.0`, `@cloudflare/workers-types: ^4`
- No deprecated packages detected. No known critical CVEs in the installed versions.

**D2 — `images: { unoptimized: true }` in next.config.mjs**
`next.config.mjs` line 10: Image optimization is disabled. This is likely intentional for static export or Cloudflare Pages compatibility, but means Next.js won't auto-optimize images.

**D3 — pnpm + npm/bun lockfile inconsistency in worker/**
`worker/` has both `package-lock.json` (npm) and `bun.lock` (bun). This is harmless but indicates the worker was initialized with multiple package managers. The root project uses pnpm.

---

## What Works Well

- All Supabase queries use parameterized filters (`.eq()`, `.in()`, `.ilike()`) — no SQL injection risk
- No hardcoded secrets anywhere in the codebase
- `lib/supabase-server.ts` correctly uses the `server-only` package to prevent client-side import
- `app/api/backfill/route.ts` is a good pattern: validates the secret header, clamps pagination params, handles errors with proper status codes — all other routes should follow this model
- Test coverage exists for the three core library modules: `bridge.test.ts`, `impact-stats.test.ts`, `rate-limiter.test.ts`, `match-reconstruction.test.ts`
- RLS is enabled on all tables with a `tighten_rls` migration that restricts anon to SELECT only
- CI pipeline runs tests and build on every PR via `.github/workflows/ci.yml`
