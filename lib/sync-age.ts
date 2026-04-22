/**
 * Client-side sync age computation.
 *
 * Classifies a player's last Riot API sync into three buckets:
 *   - "fresh":   < 30 min  — no Riot API calls, data from DB only
 *   - "stale":   30 min – 24 hr — no auto-fetch, manual "Update now" available
 *   - "expired": > 24 hr or null — auto-triggers Riot API sync
 */

export type SyncAge = "fresh" | "stale" | "expired";

const THIRTY_MINUTES = 30 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

export function computeSyncAge(lastSyncAt: string | Date | null | undefined): SyncAge {
  if (!lastSyncAt) return "expired";
  const ts = lastSyncAt instanceof Date ? lastSyncAt.getTime() : new Date(lastSyncAt).getTime();
  if (isNaN(ts)) return "expired";
  const ageMs = Date.now() - ts;
  if (ageMs < THIRTY_MINUTES) return "fresh";
  if (ageMs < ONE_DAY) return "stale";
  return "expired";
}

export function formatSyncAge(lastSyncAt: string): string {
  const ageMs = Date.now() - new Date(lastSyncAt).getTime();
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
