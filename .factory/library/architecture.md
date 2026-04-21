# Architecture

- Next.js 16 App Router, all pages "use client" (SPA pattern)
- 9 API routes in app/api/ backed by Supabase
- Riot API called directly via RIOT_API_KEY (no proxy)
- Deployment: Cloudflare Workers via @opennextjs/cloudflare
