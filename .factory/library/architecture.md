# Architecture

- Next.js 16 App Router, all pages "use client" (SPA pattern)
- 9 API routes in app/api/ backed by Supabase
- Separate Riot Proxy Worker in worker/ directory (do not touch)
- Deployment: Cloudflare Workers via @opennextjs/cloudflare
