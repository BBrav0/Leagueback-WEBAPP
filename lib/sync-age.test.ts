import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computeSyncAge, formatSyncAge } from "./sync-age";

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
