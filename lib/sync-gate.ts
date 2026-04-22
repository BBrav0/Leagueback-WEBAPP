/**
 * Server-side sync gate logic shared between API routes.
 *
 * Prevents Riot API calls when the player's last sync is within the
 * "fresh" window (< 30 minutes). This is the server-side counterpart to
 * the client-side `computeSyncAge` in `lol-stats-dashboard.tsx`.
 */

/** The fresh-window threshold in milliseconds (30 minutes). */
export const SYNC_GATE_FRESH_WINDOW_MS = 30 * 60 * 1000;

/**
 * Check whether a player's last Riot sync is within the fresh window.
 *
 * Returns a "gated" result (HTTP 429 body) when the timestamp is too
 * recent, or `null` when the request should be allowed to proceed.
 *
 * @param lastSyncAt - The `last_riot_sync_at` value from `player_sync_metadata`.
 *   May be a Date, ISO string, or null/undefined.
 */
export function checkSyncGate(
  lastSyncAt: string | Date | null | undefined
): { success: false; error: string; gatedUntil: string } | null {
  if (!lastSyncAt) return null; // no metadata → allow

  const ts =
    lastSyncAt instanceof Date
      ? lastSyncAt.getTime()
      : new Date(lastSyncAt).getTime();

  if (isNaN(ts)) return null; // unparseable → allow

  const ageMs = Date.now() - ts;

  if (ageMs < SYNC_GATE_FRESH_WINDOW_MS) {
    const gatedUntil = new Date(ts + SYNC_GATE_FRESH_WINDOW_MS).toISOString();
    return {
      success: false,
      error: "Sync gate active",
      gatedUntil,
    };
  }

  return null; // stale or expired → allow
}
