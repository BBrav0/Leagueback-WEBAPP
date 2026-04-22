# Architecture

Architectural decisions, patterns, and key module responsibilities.

---

## Sync Gate Architecture

The sync gate controls when Riot API calls are allowed per player:

- **fresh** (< 30 min since last sync): No Riot API calls. All data from DB.
- **stale** (30 min - 24 hr): No auto-fetch. Manual "Update now" button available.
- **expired** (> 24 hr or null): Auto-triggers Riot API sync.

### Key Functions
- `computeSyncAge(lastSyncAt)` — returns "fresh" | "stale" | "expired"
- `formatSyncAge(lastSyncAt)` — returns human-readable relative time string
- `BackendBridge.getSyncStatus(puuid)` — reads from `/api/player-sync-status`
- `BackendBridge.updateSyncTimestamp(puuid)` — writes via `POST /api/player-sync-status`
- `BackendBridge.syncNewHeadMatchesFromRiot(puuid, ...)` — orchestrates Riot API sync

### Tables
- `player_sync_metadata` — per-player sync tracking (last_riot_sync_at, match windows)
- `player_matches` — precomputed match summaries (the main data table)
- `match_cache` — raw Riot API JSON cache

## Data Flow
1. User visits profile → `runSearch()` in dashboard
2. Fetch account → `/api/account` (cached in `accounts` table)
3. Fetch stored matches → `/api/stored-matches` (DB only)
4. Check sync status → `/api/player-sync-status` (DB only)
5. Compute sync age → decide whether to call Riot API
6. If expired: auto-sync via `syncNewHeadMatchesFromRiot`
7. If stale: show Update button, user triggers sync manually
8. If fresh: show data from DB, no API calls

## Known Bypasses (Being Fixed)
- `checkApiHasMore` in `loadMoreDbMatches` always calls Riot regardless of syncAge
- Missing `player_sync_metadata` rows default to "expired"
- Redundant `checkApiHasMore` for new players
- `updateSyncTimestamp` not in finally block
- No server-side enforcement on API routes
