# Environment

- Node.js 22.16.0, pnpm 10.12.1
- Next.js 16.1.6 (Turbopack)
- Supabase for database (hosted externally)
- Riot Proxy Worker at riot-proxy.riot-proxy.workers.dev (separate Cloudflare Worker)

## Environment Variables (set in Cloudflare dashboard)
- SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- BACKFILL_SECRET
- RIOT_PROXY_URL (optional, has default)
