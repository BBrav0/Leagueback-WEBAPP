# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** required env vars, external services, setup quirks, platform notes.  
**What does NOT belong here:** service ports/commands (use `.factory/services.yaml`).

---

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BACKFILL_SECRET`
- `RIOT_PROXY_URL`

## External dependencies

- Supabase is the backing data store for cached accounts, cached matches, and precomputed player match rows.
- The live Supabase project for this mission is `LeagueBack` (`lovbyjahuxfokpbkxviz`); schema changes should be applied there via tracked migrations.
- Riot data is fetched through the configured Riot proxy / worker URL; this mission should reuse the existing proxy setup.
- Current-rank account responses may include both `summonerId` and a derived `rankLookupId`; workers validating DB-backed card rank snapshots should treat those account/cache fields as the first place to confirm the live Riot identifier path.
- For Cloudflare worker deploys in this mission, Wrangler auth resolves to account ID `84abf047ff97885a578db1fff2bdb463`; non-interactive deploys should set `CLOUDFLARE_ACCOUNT_ID` (or equivalent config) to that account so `riot-proxy` deploys do not stall on multi-account selection.

## Platform notes

- This machine is Windows. The initial repo state had a POSIX-only `npm run dev` script, so workers must be careful to keep local startup Windows-safe.
- Use `pnpm` as the primary package manager for this mission's workflow updates.
- Do not commit secrets or copied live-user data.
