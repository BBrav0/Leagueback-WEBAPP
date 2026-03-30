# Architecture

Architecture decisions, data flow notes, and implementation boundaries for this mission.

---

## Current application shape

- Next.js App Router web app.
- Main user surface is the dashboard mounted from:
  - `app/page.tsx`
  - `app/player/[gameName]/page.tsx`
- Most current UI/state behavior lives in `components/dashboard/lol-stats-dashboard.tsx`.

## Existing data flow

1. User searches a Riot ID.
2. Frontend calls `/api/account`.
3. Stored match history is loaded from `/api/stored-matches`.
4. Newer or older match data may be fetched through `/api/match-history` and `/api/match-performance`.
5. Supabase stores cached/raw match data plus precomputed player match rows.

## Mission focus

- Realign the product as web-only.
- Refresh markdown and workflow truthfulness.
- Finish non-algorithm web features: saved lookups, richer match surfaces, details UI, filters/preferences, export, copy polish.

## Out of scope

- Impact algorithm changes.
- Desktop/Electron/mobile-native packaging.
- New auth systems or unrelated infrastructure rewrites.

## Known structural risks

- The dashboard component is large and state-heavy; workers should extract helpers/components only when it directly improves the scoped feature.
- Current summary data and raw match detail data are separate concerns; details UI should use a deliberate mapping layer rather than overloading the summary shape.
- Match-details raw source precedence is `match_cache` first, then legacy `match_details`, otherwise an explicit unavailable payload; details work should preserve truthful fallback semantics for both missing and partial raw data.
