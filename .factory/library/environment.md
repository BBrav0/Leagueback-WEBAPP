# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

| Variable | Purpose | Where Used |
|----------|---------|------------|
| `DATABASE_URL` | Neon PostgreSQL connection string | `lib/neon.ts`, `scripts/backfill-player-match-role-damage.ts` |
| `RIOT_API_KEY` | Riot Games API key | `lib/riot-api-service.ts` |
| `BACKFILL_SECRET` | Secret header for /api/backfill endpoint | `app/api/backfill/route.ts` |

## Neon Database

- **Project:** misty-shadow-24055221 (Leagueback)
- **Region:** us-east-1
- **PostgreSQL:** v17
- **Connection:** via `@neondatabase/serverless` HTTP mode (neon() function)
- **Database name:** neondb

## Platform Notes

- **Windows** development environment (PowerShell/CMD)
- **pnpm** package manager (v10.12.1)
- Node.js required for `@neondatabase/serverless` >= 19
