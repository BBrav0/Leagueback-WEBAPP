import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computeSyncAge, computeCountdownRemaining, formatCountdown, formatSyncAge } from "./sync-age";

describe("computeSyncAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'expired' when lastSyncAt is null", () => {
    expect(computeSyncAge(null)).toBe("expired");
  });

  it("returns 'expired' when lastSyncAt is undefined", () => {
    expect(computeSyncAge(undefined)).toBe("expired");
  });

  it("returns 'expired' when lastSyncAt is an empty string", () => {
    expect(computeSyncAge("")).toBe("expired");
  });

  it("returns 'expired' when lastSyncAt is an unparseable string", () => {
    expect(computeSyncAge("not-a-date")).toBe("expired");
  });

  it("returns 'fresh' when lastSyncAt is just now", () => {
    const now = new Date().toISOString();
    expect(computeSyncAge(now)).toBe("fresh");
  });

  it("returns 'fresh' when lastSyncAt is 5 minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(computeSyncAge(fiveMinAgo)).toBe("fresh");
  });

  it("returns 'fresh' when lastSyncAt is 29 minutes 59 seconds ago", () => {
    const almost30 = new Date(Date.now() - 29 * 60 * 1000 - 59 * 1000).toISOString();
    expect(computeSyncAge(almost30)).toBe("fresh");
  });

  it("returns 'stale' when lastSyncAt is exactly 30 minutes ago", () => {
    const exactly30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(computeSyncAge(exactly30)).toBe("stale");
  });

  it("returns 'stale' when lastSyncAt is 31 minutes ago", () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(computeSyncAge(stale)).toBe("stale");
  });

  it("returns 'stale' when lastSyncAt is 2 hours ago", () => {
    const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(computeSyncAge(hoursAgo)).toBe("stale");
  });

  it("returns 'stale' when lastSyncAt is 23 hours 59 minutes ago", () => {
    const almost24 = new Date(Date.now() - 23 * 60 * 60 * 1000 - 59 * 60 * 1000).toISOString();
    expect(computeSyncAge(almost24)).toBe("stale");
  });

  it("returns 'expired' when lastSyncAt is exactly 24 hours ago", () => {
    const exactly24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(computeSyncAge(exactly24)).toBe("expired");
  });

  it("returns 'expired' when lastSyncAt is 2 days ago", () => {
    const daysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeSyncAge(daysAgo)).toBe("expired");
  });

  it("accepts Date objects as input", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(computeSyncAge(fiveMinAgo)).toBe("fresh");
  });

  it("accepts an invalid Date object as input", () => {
    const invalidDate = new Date("invalid");
    expect(computeSyncAge(invalidDate)).toBe("expired");
  });

  // Edge case: null with stored matches override
  // This tests the logic that the DASHBOARD applies AFTER calling computeSyncAge.
  // The function itself always returns 'expired' for null — the dashboard
  // overrides to 'stale' when storedResult.totalCount > 0.
  it("returns 'expired' for null — dashboard code overrides to 'stale' when stored matches exist", () => {
    // This documents the contract: computeSyncAge(null) = 'expired'
    // The caller (dashboard) then overrides to 'stale' if there are stored matches.
    expect(computeSyncAge(null)).toBe("expired");
  });
});

describe("formatSyncAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for less than 60 seconds ago", () => {
    const now = new Date().toISOString();
    expect(formatSyncAge(now)).toBe("just now");
  });

  it("returns '1 minute ago' for 60 seconds ago", () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatSyncAge(oneMinAgo)).toBe("1 minute ago");
  });

  it("returns '5 minutes ago' for 5 minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatSyncAge(fiveMinAgo)).toBe("5 minutes ago");
  });

  it("returns '1 hour ago' for 60 minutes ago", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatSyncAge(oneHourAgo)).toBe("1 hour ago");
  });

  it("returns '2 hours ago' for 2 hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatSyncAge(twoHoursAgo)).toBe("2 hours ago");
  });

  it("returns '1 day ago' for 24 hours ago", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatSyncAge(oneDayAgo)).toBe("1 day ago");
  });

  it("returns '3 days ago' for 3 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatSyncAge(threeDaysAgo)).toBe("3 days ago");
  });
});

/**
 * VAL-SYNC-014: "Load more from Riot" button gated during fresh window.
 *
 * The gate condition is `syncAge !== "fresh"` — the Load More button must not
 * be rendered (or must be disabled) when the player's sync is fresh. This
 * describes pure-function tests for the condition; the component JSX in
 * lol-stats-dashboard.tsx applies the same check.
 */
describe("load-more sync-age gate condition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks load-more when sync is fresh (5 min ago)", () => {
    const syncAge = computeSyncAge(new Date(Date.now() - 5 * 60 * 1000).toISOString());
    expect(syncAge).toBe("fresh");
    expect(syncAge !== "fresh").toBe(false);
  });

  it("blocks load-more when sync is fresh (just now)", () => {
    const syncAge = computeSyncAge(new Date().toISOString());
    expect(syncAge).toBe("fresh");
    expect(syncAge !== "fresh").toBe(false);
  });

  it("allows load-more when sync is stale (1 hour ago)", () => {
    const syncAge = computeSyncAge(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    expect(syncAge).toBe("stale");
    expect(syncAge !== "fresh").toBe(true);
  });

  it("allows load-more when sync is expired (2 days ago)", () => {
    const syncAge = computeSyncAge(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
    expect(syncAge).toBe("expired");
    expect(syncAge !== "fresh").toBe(true);
  });

  it("allows load-more when sync is stale (exactly 30 min boundary)", () => {
    const syncAge = computeSyncAge(new Date(Date.now() - 30 * 60 * 1000).toISOString());
    expect(syncAge).toBe("stale");
    expect(syncAge !== "fresh").toBe(true);
  });
});

describe("computeCountdownRemaining", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 when lastSyncAt is null", () => {
    expect(computeCountdownRemaining(null)).toBe(0);
  });

  it("returns 0 when lastSyncAt is undefined", () => {
    expect(computeCountdownRemaining(undefined)).toBe(0);
  });

  it("returns 0 for an invalid date string", () => {
    expect(computeCountdownRemaining("not-a-date")).toBe(0);
  });

  it("returns ~30 min remaining for just-now sync", () => {
    const now = new Date().toISOString();
    const remaining = computeCountdownRemaining(now);
    // Should be very close to 30 minutes (allowing for ms rounding)
    expect(remaining).toBeGreaterThan(29 * 60 * 1000 - 1);
    expect(remaining).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it("returns ~25 min remaining for 5-min-ago sync", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const remaining = computeCountdownRemaining(fiveMinAgo);
    expect(remaining).toBeGreaterThan(24 * 60 * 1000 - 1);
    expect(remaining).toBeLessThanOrEqual(25 * 60 * 1000);
  });

  it("returns 0 when the fresh window has elapsed (31 min ago)", () => {
    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(computeCountdownRemaining(thirtyOneMinAgo)).toBe(0);
  });

  it("returns small remaining for 29 min 59 sec ago", () => {
    const almostExpired = new Date(Date.now() - 29 * 60 * 1000 - 59 * 1000).toISOString();
    const remaining = computeCountdownRemaining(almostExpired);
    // Should be about 1 second remaining
    expect(remaining).toBeLessThanOrEqual(2000);
    expect(remaining).toBeGreaterThan(0);
  });

  it("accepts Date objects as input", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const remaining = computeCountdownRemaining(fiveMinAgo);
    expect(remaining).toBeGreaterThan(24 * 60 * 1000 - 1);
    expect(remaining).toBeLessThanOrEqual(25 * 60 * 1000);
  });
});

describe("formatCountdown", () => {
  it("formats 30 minutes as 30:00", () => {
    expect(formatCountdown(30 * 60 * 1000)).toBe("30:00");
  });

  it("formats 25 minutes 30 seconds as 25:30", () => {
    expect(formatCountdown(25 * 60 * 1000 + 30 * 1000)).toBe("25:30");
  });

  it("formats 1 minute 5 seconds as 01:05", () => {
    expect(formatCountdown(65 * 1000)).toBe("01:05");
  });

  it("formats 0 as 00:00", () => {
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("formats negative values as 00:00", () => {
    expect(formatCountdown(-5000)).toBe("00:00");
  });

  it("formats 5 seconds as 00:05", () => {
    expect(formatCountdown(5000)).toBe("00:05");
  });

  it("formats 59 seconds as 00:59", () => {
    expect(formatCountdown(59 * 1000)).toBe("00:59");
  });
});
