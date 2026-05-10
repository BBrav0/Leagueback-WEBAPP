# Leagueback

**League of Legends ranked match analysis tool.** Players look up their Riot ID and see their match history with an "impact score" that measures their contribution relative to the team average.

## Features

- **Riot ID lookup** — Search for any ranked player by game name and tag line
- **Match history** — Browse stored ranked match history with infinite scroll pagination
- **Impact scoring** — Per-match impact score measuring individual contribution relative to team average, with category breakdowns
- **Analytics charts** — Lifetime impact category statistics and trend visualizations
- **Sync gating** — Automatic and manual data sync with age-based refresh controls and countdown timer
- **Shareable player routes** — Deep-linkable URLs at `/[gameName]#tagLine`

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + React 18 + TypeScript |
| Database | Neon (PostgreSQL) |
| Styling | Tailwind CSS + Radix UI (shadcn/ui) |
| Charts | Recharts |
| Testing | Vitest |
| Hosting | Vercel (primary) / Cloudflare Pages (via OpenNext) |
| Package Manager | pnpm |

## Prerequisites

- **Node.js** 20+
- **pnpm** (committed lockfile: `pnpm-lock.yaml`)

## Getting Started

### 1. Install dependencies

```bash
pnpm install --frozen-lockfile
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description | Server-only |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string (`lib/neon.ts`) | Yes |
| `RIOT_API_KEY` | Riot Games API key for server-side API calls | Yes |
| `BACKFILL_SECRET` | Secret header value for the `/api/backfill` endpoint | Yes |
| `ANALYTICS_API_KEY` | Auth credential for the analytics summary endpoint (`GET /api/analytics/summary`) | Yes |
| `ANALYTICS_HMAC_KEY` | Server-only HMAC key for analytics identifier hashing (min 32 characters) | Yes |

> **Server-only:** These variables are referenced exclusively in server-side code guarded by the `server-only` package. They are never exposed to the browser bundle or analytics payloads.

### 3. Run the development server

```bash
pnpm dev
```

Open [http://localhost:3005](http://localhost:3005).

### 4. Available scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server on port 3005 |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm test` | Run tests (Vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | ESLint with zero-warning policy |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm static-check` | Run lint + typecheck together |

## Project Structure

```
├── app/                          # Next.js App Router
│   ├── api/                      #   API route handlers
│   │   ├── account/              #     Riot account lookup
│   │   ├── analytics/            #     Analytics ingestion & summary
│   │   ├── backfill/             #     Data backfill (secret-protected)
│   │   ├── impact-categories/    #     Impact stats endpoint
│   │   ├── match-history/        #     Fresh match history from Riot API
│   │   ├── match-performance/    #     Per-match performance data
│   │   ├── player-matches/       #     Player match data & existing IDs
│   │   ├── player-sync-status/   #     Sync status & age info
│   │   └── stored-matches/       #     Paginated DB match results
│   ├── [gameName]/               #   Player page route
│   ├── player/                   #   Player views
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                  #   Home / search page
├── components/
│   ├── dashboard/                #   Main dashboard (lol-stats-dashboard.tsx)
│   └── ui/                       #   shadcn/ui primitives (Radix-based)
├── hooks/                        #   Custom React hooks
├── lib/                          #   Core business logic & data access
│   ├── analytics.ts              #     Server analytics core (validation, hashing, fail-open writes)
│   ├── analytics-client.ts       #     Browser analytics client (session mgmt, event tracking)
│   ├── analytics-instrumentation.ts #  API route instrumentation helpers
│   ├── bridge.ts                 #     API↔DB synchronization bridge
│   ├── database-queries.ts       #     Parameterized SQL queries (Neon)
│   ├── match-reconstruction.ts   #     Timeline reconstruction
│   ├── neon.ts                   #     Database client (server-only guarded)
│   ├── performance-calculation.ts#     Impact score math
│   ├── riot-api-service.ts       #     Riot API client + caching
│   ├── sync-age.ts               #     Sync freshness / age tracking
│   ├── sync-gate.ts              #     Sync gate logic
│   ├── types.ts                  #     Shared TypeScript types
│   └── ...                       #     Other modules (rate-limiter, history, etc.)
├── scripts/                      #   One-off utility scripts
├── public/                       #   Static assets
└── vitest.config.ts
```

## Data Flow

1. **Account lookup** — User submits Riot ID → `/api/account` → cached in `accounts` table or fetched from Riot API
2. **Match history** — `/api/match-history` fetches fresh data directly from Riot API
3. **Match performance** — For each match, `/api/match-performance` checks `match_cache`; on cache miss, fetches from Riot API and stores in `match_cache` + `player_matches`
4. **Stored matches** — Paginated results served from `player_matches` via `/api/stored-matches`
5. **Impact categories** — Aggregated stats served from `/api/impact-categories`

All database access is server-side only (`lib/neon.ts` uses the `server-only` package). No API keys are exposed to the client.

### Database Tables

| Table | Purpose |
|---|---|
| `accounts` | Riot account cache (puuid, game_name, tag_line) |
| `match_cache` | Combined match + timeline JSON cache |
| `player_matches` | Precomputed summaries (champion, KDA, impact scores) |
| `analytics_events` | Privacy-light first-party analytics events (dedicated table) |

## Testing

Tests use [Vitest](https://vitest.dev/) with jsdom. Core library modules have test coverage:

```bash
pnpm test          # Single run
pnpm test:watch    # Watch mode
```

Test files are co-located with their modules in `lib/` (e.g., `bridge.test.ts`, `sync-age.test.ts`, `riot-api-service.test.ts`).

CI runs the full validation pipeline on every PR via `.github/workflows/ci.yml`.

## Product Analytics

Leagueback includes a privacy-light, first-party analytics system stored in Neon/PostgreSQL. No paid analytics SaaS is used.

### Neon SQL / Migration Setup

Analytics storage is created via the migration file `supabase/migrations/20260510000000_create_analytics_events.sql`. To set up analytics:

```bash
# Apply the analytics migration to your Neon database
psql "$DATABASE_URL" -f supabase/migrations/20260510000000_create_analytics_events.sql
```

Or apply via the Neon SQL editor / MCP tool. The migration creates:

- `analytics_events` table — dedicated analytics storage, separate from product cache tables
- `idx_analytics_events_created_at_event` — index for summary queries (day + event name)
- `idx_analytics_events_session_id` — index for session-scoped queries
- `idx_analytics_events_visitor_id` — index for visitor-scoped queries
- `idx_analytics_events_event_name` — index for event name filtering
- Row-level security enabled: the table owner (Neon connection role) bypasses RLS; all other roles are blocked

> **Note:** The migration is idempotent-safe for review but should be applied once. Existing product tables (`accounts`, `match_cache`, `player_matches`) are not modified.

### Tracked Event Contract

| Event Name | Trigger Point | Allowed Properties | Privacy Treatment |
|---|---|---|---|
| `page_view` | Homepage or generic page load | `page` (sanitized path), `referrer` (coarse category) | Route paths stripped of player identifiers; no raw Riot IDs |
| `visitor_activity` | Reserved (not currently emitted) | Same as `page_view` | Accepted by ingest but not emitted by the browser client; session initialization uses `page_view` instead |
| `search_attempt` | User submits Riot ID search | `queryHash` (client-side hash), `hasTagLine` | Raw game name / tag line never sent; client-side hash + server HMAC |
| `lookup_success` | Account/match data resolve | `matchCount` | No raw PUUID, Riot ID, or match IDs |
| `lookup_failure` | Lookup fails with reason | `failureCategory` (bounded enum) | Bounded to approved categories; no raw error messages |
| `player_page_view` | Deep-linked player route load | `page` (sanitized), `referrer` | Route path sanitized to `/player`; re-renders do not duplicate |
| `match_detail_view` | User expands match details | `matchRef` (hashed match ID) | Raw match ID hashed client-side and server-side |
| `load_more` | Stored-match pagination triggers | `offset`, `limit`, `source` | No raw identifiers |
| `manual_update` | User clicks manual update | `outcome` | Bounded outcome string |
| `client_error` | Client-side error/noise event | `category` (bounded enum), `route` (sanitized) | No stack traces, cookies, auth headers, or raw paths |
| `endpoint_outcome` | Server API route completes (non-error) | `route`, `method`, `status`, `statusClass` | Route templates only; no raw paths/query strings |
| `endpoint_error` | Server API route returns error or throws | `route`, `method`, `status`, `statusClass`, `failureCategory` | Sanitized properties; no secrets, SQL, or long exceptions |

**Approved failure categories** for `lookup_failure`: `account_not_found`, `match_data_unavailable`, `rate_limited`, `server_error`, `network_error`, `validation_error`, `unknown`.

**Approved failure categories** for `endpoint_error`: `rate_limited`, `client_error`, `server_error`, `unhandled_exception`, `unknown`.

### Hermes Summary Endpoint

**`GET /api/analytics/summary?days=7`**

Protected by `ANALYTICS_API_KEY` via an `Authorization` header with the bearer scheme. Returns aggregate-only analytics. Never exposes raw event rows, identifiers, or secrets.

#### Authentication

All requests must include:

Set the `Authorization` header using the bearer scheme with your `ANALYTICS_API_KEY` value.

Missing or incorrect credentials return `401`.

#### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `days` | integer | `7` | Number of days to include (1–365). Invalid values return `400`. |

#### Response Shape

```json
{
  "daily": [
    { "day": "2026-05-09", "event_name": "page_view", "count": 42 }
  ],
  "totals": [
    { "event_name": "page_view", "count": 350 },
    { "event_name": "search_attempt", "count": 120 }
  ],
  "searchFunnel": {
    "attempts": 120,
    "successes": 95,
    "failures": 8
  },
  "failureCategories": {
    "lookup_failure": 8,
    "client_error": 3,
    "endpoint_error": 2
  },
  "matchDetailCounts": {
    "matches": 95,
    "details": 210
  },
  "endpointErrors": [
    { "day": "2026-05-09", "count": 1 }
  ],
  "noisyTraffic": {
    "rejectedEvents": 3
  }
}
```

All fields are present even when data is empty/sparse (zeroed arrays/counters). Empty or sparse data windows return `200` with the same stable shape.

#### Curl Examples for Hermes

The summary endpoint requires the `ANALYTICS_API_KEY` environment variable passed in the `Authorization` header (bearer scheme). Export the variable and use it in your request.

**Authorized request (7-day summary):**

```bash
# Replace with your actual key before running
export ANALYTICS_API_KEY=
curl -s -H "Authorization: Bearer-cred \$ANALYTICS_API_KEY" \
  "https://your-leagueback-domain.vercel.app/api/analytics/summary?days=7"
```

> Replace `Bearer-cred` with `Bearer` followed by a space and your key value.

**Authorized request (30-day summary):**

```bash
curl -s -H "Authorization: Bearer-cred \$ANALYTICS_API_KEY" \
  "https://your-leagueback-domain.vercel.app/api/analytics/summary?days=30"
```

**Unauthorized request (should return 401):**

```bash
curl -s -w "\\nHTTP %{http_code}\\n" \
  "https://your-leagueback-domain.vercel.app/api/analytics/summary?days=7"
```

### Analytics Retention and Cleanup

Analytics events are stored with a `created_at` timestamp and indexed for time-range queries. Retention posture:

- **No automatic deletion** is currently implemented. Analytics rows persist indefinitely.
- The `idx_analytics_events_created_at_event` index supports efficient `WHERE created_at < NOW() - INTERVAL 'N days'` cleanup queries.
- Recommended manual cleanup SQL (adjust retention period as needed):

```sql
-- Delete analytics events older than 90 days
DELETE FROM analytics_events
WHERE created_at < NOW() - INTERVAL '90 days';
```

- For automated cleanup, consider a Neon scheduled function or `pg_cron` extension to run this periodically.
- Event property sizes are bounded (max 512 chars per value, max 24 properties per event) to keep storage low-cost.

### Instrumented API Routes

The following API routes emit server-side analytics events via route instrumentation. Exactly one `endpoint_outcome` or `endpoint_error` event is recorded per request, without changing route status codes, response bodies, or error semantics:

| Route | Template |
|---|---|
| `/api/account` | `/api/account` |
| `/api/match-history` | `/api/match-history` |
| `/api/match-performance` | `/api/match-performance` |
| `/api/stored-matches` | `/api/stored-matches` |
| `/api/match-details` | `/api/match-details` |
| `/api/impact-categories` | `/api/impact-categories` |
| `/api/player-sync-status` | `/api/player-sync-status` |
| `/api/player-matches/existing-ids` | `/api/player-matches/existing-ids` |
| `/api/player-matches/stale-ids` | `/api/player-matches/stale-ids` |

## Deployment

### Vercel (primary)

Push to `main` — Vercel auto-deploys. Set all required environment variables in the Vercel project settings:

- `DATABASE_URL`
- `RIOT_API_KEY`
- `BACKFILL_SECRET`
- `ANALYTICS_API_KEY` (for Hermes summary access)
- `ANALYTICS_HMAC_KEY` (min 32 characters, for identifier hashing)

### Cloudflare Pages

```bash
pnpm preview       # Build and preview locally
pnpm deploy        # Build and deploy to Cloudflare
```

Uses `@opennextjs/cloudflare` adapter (see `open-next.config.ts` and `wrangler.jsonc`).

## Disclaimer

Leagueback is not endorsed by Riot Games. All in-game names and imagery are trademarks of Riot Games, Inc.
