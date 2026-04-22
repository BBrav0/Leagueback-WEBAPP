import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { checkSyncGate, SYNC_GATE_FRESH_WINDOW_MS } from "./sync-gate";

describe("checkSyncGate", () => {
  const realNow = Date.now;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when lastSyncAt is null", () => {
    expect(checkSyncGate(null)).toBeNull();
  });

  it("returns null when lastSyncAt is undefined", () => {
    expect(checkSyncGate(undefined)).toBeNull();
  });

  it("returns null when lastSyncAt is an empty string", () => {
    expect(checkSyncGate("")).toBeNull();
  });

  it("returns null when lastSyncAt is unparseable", () => {
    expect(checkSyncGate("not-a-date")).toBeNull();
  });

  it("returns gate result when lastSyncAt is within the fresh window (just now)", () => {
    const justNow = new Date().toISOString();
    const result = checkSyncGate(justNow);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      success: false,
      error: "Sync gate active",
      gatedUntil: new Date(Date.now() + SYNC_GATE_FRESH_WINDOW_MS).toISOString(),
    });
  });

  it("returns gate result when lastSyncAt is 5 minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = checkSyncGate(fiveMinAgo);
    expect(result).not.toBeNull();
    expect(result?.error).toBe("Sync gate active");
    expect(result?.success).toBe(false);
    // gatedUntil should be 25 minutes from now
    const expectedGatedUntil = new Date(Date.now() + 25 * 60 * 1000).toISOString();
    expect(result?.gatedUntil).toBe(expectedGatedUntil);
  });

  it("returns gate result when lastSyncAt is 29 minutes 59 seconds ago", () => {
    const almostStale = new Date(Date.now() - 29 * 60 * 1000 - 59 * 1000).toISOString();
    const result = checkSyncGate(almostStale);
    expect(result).not.toBeNull();
    expect(result?.error).toBe("Sync gate active");
  });

  it("returns null when lastSyncAt is exactly 30 minutes ago (boundary)", () => {
    const exactly30 = new Date(Date.now() - SYNC_GATE_FRESH_WINDOW_MS).toISOString();
    const result = checkSyncGate(exactly30);
    expect(result).toBeNull();
  });

  it("returns null when lastSyncAt is 31 minutes ago (stale)", () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(checkSyncGate(stale)).toBeNull();
  });

  it("returns null when lastSyncAt is 2 hours ago (stale)", () => {
    const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(checkSyncGate(hoursAgo)).toBeNull();
  });

  it("returns null when lastSyncAt is 2 days ago (expired)", () => {
    const daysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(checkSyncGate(daysAgo)).toBeNull();
  });

  it("accepts Date objects as input", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = checkSyncGate(fiveMinAgo);
    expect(result).not.toBeNull();
    expect(result?.error).toBe("Sync gate active");
  });

  it("computes gatedUntil correctly from the lastSyncAt timestamp", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const result = checkSyncGate(tenMinAgo);
    expect(result).not.toBeNull();
    const expectedGatedUntil = new Date(
      tenMinAgo.getTime() + SYNC_GATE_FRESH_WINDOW_MS
    ).toISOString();
    expect(result?.gatedUntil).toBe(expectedGatedUntil);
  });
});

describe("SYNC_GATE_FRESH_WINDOW_MS", () => {
  it("is 30 minutes in milliseconds", () => {
    expect(SYNC_GATE_FRESH_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});
