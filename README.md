# Leagueback

Leagueback is a web-only Next.js app for League of Legends ranked match analysis.
Players search by Riot ID, open shareable player routes, and review match history,
impact score summaries, and supporting charts sourced through the existing
Supabase cache and Riot proxy workflow.

## Current product summary

Leagueback currently ships a browser-first experience built around:

- Riot ID account lookup
- Deep-linkable player routes at `/player/{gameName}#{tagLine}`
- Stored ranked match history loading with older-history expansion
- Match summary cards plus impact/lifetime analytics charts
- Supabase-backed caching and API orchestration for Riot data

## Shipped today

The current repository state supports these user-visible behaviors:

- Search for a player by Riot ID from the home page
- Load the same player directly from a player route without re-submitting the form
- View stored match history and load additional history as available
- See impact category statistics, lifetime analytics, and related dashboard charts
- Use the existing web API routes backed by Supabase and the Riot proxy worker

## Backlog / not shipped yet

The roadmap backlog is still focused on web-only improvements, including:

- richer match-card metadata and truthful rank fallback states
- deeper match-details views
- saved lookups, filters, and persisted history preferences
- loaded-history export and broader copy/fallback polish

These are planned web UX improvements only. This repo does **not** currently ship
desktop, Electron, mobile-native, or algorithm-change work.

## Local setup

Leagueback uses `pnpm` as the committed package manager and local workflow.

### 1. Install dependencies

```bash
pnpm install --frozen-lockfile
```

### 2. Create local environment variables

Copy `.env.example` to `.env.local` and replace the placeholder values with your
local/project secrets:

```bash
cp .env.example .env.local
```

Required variables are:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BACKFILL_SECRET`
- `RIOT_PROXY_URL` (optional if using the default proxy URL)

### 3. Start the web app

The committed local dev command uses the mission port `3005`:

```bash
pnpm run dev
```

Then open `http://localhost:3005`.

## Validation workflow

The committed validation commands for this repo are:

```bash
pnpm run lint
pnpm run static-check
pnpm run typecheck
pnpm test
pnpm run build
```

CI runs the same validation flow from `.github/workflows/ci.yml`.

## Architecture notes

- Framework: Next.js 16 App Router + React + TypeScript
- Styling/UI: Tailwind CSS + Radix UI / shadcn components
- Data/cache: Supabase
- Riot access: Cloudflare Worker proxy
- Hosting target: Vercel

## Disclaimer

Leagueback isn't endorsed by Riot Games. All in-game names and imagery belong to
Riot Games.
