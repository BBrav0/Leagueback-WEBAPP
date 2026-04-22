# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

| Variable | Purpose | Required for |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string | All DB operations |
| `RIOT_API_KEY` | Riot Games API key | Riot API calls (match-history, match-performance, account lookup) |
| `BACKFILL_SECRET` | Header secret for /api/backfill | Backfill endpoint only |

## Platform Notes

- Windows development environment (win32 10.0.26200)
- Node.js 20, pnpm package manager
- Neon serverless driver uses HTTP mode (no persistent connections)
- `server-only` package guards all DB access from client-side import
