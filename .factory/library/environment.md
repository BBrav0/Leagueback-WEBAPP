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
- Riot data is fetched through the configured Riot proxy / worker URL; this mission should reuse the existing proxy setup.

## Platform notes

- This machine is Windows. The initial repo state had a POSIX-only `npm run dev` script, so workers must be careful to keep local startup Windows-safe.
- Use `pnpm` as the primary package manager for this mission's workflow updates.
- Do not commit secrets or copied live-user data.
