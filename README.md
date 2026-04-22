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

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string (`lib/neon.ts`) |
| `RIOT_API_KEY` | Riot Games API key for server-side API calls |
| `BACKFILL_SECRET` | Secret header value for the `/api/backfill` endpoint |

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

## Testing

Tests use [Vitest](https://vitest.dev/) with jsdom. Core library modules have test coverage:

```bash
pnpm test          # Single run
pnpm test:watch    # Watch mode
```

Test files are co-located with their modules in `lib/` (e.g., `bridge.test.ts`, `sync-age.test.ts`, `riot-api-service.test.ts`).

CI runs the full validation pipeline on every PR via `.github/workflows/ci.yml`.

## Deployment

### Vercel (primary)

Push to `main` — Vercel auto-deploys. Set `DATABASE_URL`, `RIOT_API_KEY`, and `BACKFILL_SECRET` in the Vercel project settings.

### Cloudflare Pages

```bash
pnpm preview       # Build and preview locally
pnpm deploy        # Build and deploy to Cloudflare
```

Uses `@opennextjs/cloudflare` adapter (see `open-next.config.ts` and `wrangler.jsonc`).

## Disclaimer

Leagueback is not endorsed by Riot Games. All in-game names and imagery are trademarks of Riot Games, Inc.
