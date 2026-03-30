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
- Follow up on returning-player data freshness so existing Supabase-backed history is reconciled against Riot and stale derived rows do not linger indefinitely.

## Out of scope

- Impact algorithm changes.
- Desktop/Electron/mobile-native packaging.
- New auth systems or unrelated infrastructure rewrites.

## Known structural risks

- The dashboard component is large and state-heavy; workers should extract helpers/components only when it directly improves the scoped feature.
- Current summary data and raw match detail data are separate concerns; details UI should use a deliberate mapping layer rather than overloading the summary shape.
- Match-details raw source precedence is `match_cache` first, then legacy `match_details`, otherwise an explicit unavailable payload; details work should preserve truthful fallback semantics for both missing and partial raw data.
- Current returning-player freshness logic is client-driven and treats \"latest stored match exists\" as effectively fresh. Follow-up work should preserve DB-first rendering but add bounded reconciliation against Riot plus durable sync state so missing recent matches and stale derived rows can be corrected against the existing database.
- Returning-player stale detection must be match-specific, not only player-level. Refreshing one stale row must not mark the whole player fresh if other recent rows were never recomputed.
- Durable freshness metadata must keep latest-head markers monotonic; reprocessing an older stale match must not move `latest_riot_*` or `latest_db_*` backward.
- Stale-only refreshes still need to reload the visible DB-first history in the dashboard so the user sees refreshed derived rows immediately after reconciliation.
- Stored match-card metadata must be persisted through `player_matches` and the DB-backed `/api/stored-matches` path. If role/lane or damage-to-champions are supported on cards, the stored-row mapper must preserve those fields instead of rebuilding every stored card with unavailable fallbacks.
- Any rank shown on match cards in this mission must be modeled as a current rank snapshot sourced outside the match payload, not as historical per-match rank. Copy and persistence must make that distinction explicit so the UI does not imply unsupported match-time rank history.
- Riot rank lookups are a moving integration surface: if the live `league-v4 entries/by-summoner` path returns forbidden responses for a verified current identifier, workers should treat that as an endpoint/identifier contract problem and switch to the correct current Riot endpoint/identifier pair rather than forcing the old path.
