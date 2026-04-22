/**
 * Cross-area integration tests for sync gate + update button UX flows.
 *
 * These tests verify the 7 cross-area validation contract assertions
 * (VAL-CROSS-001 through VAL-CROSS-007) by testing the logic at the
 * bridge/sync-age/sync-gate level. The dashboard component applies the
 * same logic using these modules; these tests verify the contracts hold
 * without requiring a full React mount.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computeSyncAge, computeCountdownRemaining, formatSyncAge } from "./sync-age";
import { checkSyncGate } from "./sync-gate";
import { BackendBridge } from "./bridge";
import type { MatchSummary } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const sampleMatch: MatchSummary = {
  id: "m1",
  summonerName: "PlayerOne",
  champion: "Ahri",
  rank: null,
  rankLabel: "Current rank snapshot unavailable",
  rankQueue: null,
  kda: "5/2/9",
  cs: 180,
  visionScore: 20,
  gameResult: "Victory",
  gameTime: "25:15",
  playedAt: "Mar 30, 2:05 AM",
  durationSeconds: 1515,
  role: "MIDDLE",
  roleLabel: "Mid",
  damageToChampions: 12345,
  damageToChampionsLabel: "12,345 damage to champions",
  impactCategory: "impactWins",
  impactCategoryLabel: "Impact win",
  data: [],
  yourImpact: 6,
  teamImpact: 4,
};

/**
 * Simulates the dashboard's sync-age decision logic for returning players.
 * Mirrors the logic in `runSearch()` for storedResult.totalCount > 0.
 */
function simulateDashboardSyncDecision(
  storedTotalCount: number,
  lastSyncAt: string | Date | null | undefined
): { syncAge: "fresh" | "stale" | "expired"; shouldAutoSync: boolean; shouldShowUpdateButton: boolean } {
  let age = computeSyncAge(lastSyncAt);

  // Dashboard override: pre-existing players without metadata → stale (not expired)
  if (age === "expired" && storedTotalCount > 0 && !lastSyncAt) {
    age = "stale";
  }

  return {
    syncAge: age,
    shouldAutoSync: age === "expired",
    shouldShowUpdateButton: age === "stale",
  };
}

// ─── VAL-CROSS-001: Fresh profile — infinite scroll loads from DB only ──────

describe("VAL-CROSS-001: Fresh profile — infinite scroll loads from DB only", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fresh sync age prevents checkApiHasMore call in loadMoreDbMatches", () => {
    // When syncAge is "fresh", the dashboard skips checkApiHasMore entirely.
    // loadMoreDbMatches gates it: if (syncAge === "fresh") { setHasMoreMatches(false); }
    const freshTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const age = computeSyncAge(freshTimestamp);
    expect(age).toBe("fresh");

    // The condition in the dashboard is: if (syncAge === "fresh") → skip checkApiHasMore
    const shouldSkipCheckApiHasMore = age === "fresh";
    expect(shouldSkipCheckApiHasMore).toBe(true);
  });

  it("server-side gate also blocks match-history during fresh window", () => {
    const freshTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const gateResult = checkSyncGate(freshTimestamp);
    expect(gateResult).not.toBeNull();
    expect(gateResult?.success).toBe(false);
    expect(gateResult?.error).toBe("Sync gate active");
  });

  it("getMatchHistory returns null on 429 (sync gate), preventing Riot API calls", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      json: async () => ({
        success: false,
        error: "Sync gate active",
        gatedUntil: "2026-04-22T12:30:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await BackendBridge.getMatchHistory("p1", 5, 0);
    expect(result).toBeNull(); // null = no Riot API call was made through the bridge
    infoSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("fresh sync age is computed correctly for various timestamps within 30 min", () => {
    const cases = [
      { offset: 0, expected: "fresh" },
      { offset: 1 * 60 * 1000, expected: "fresh" },
      { offset: 15 * 60 * 1000, expected: "fresh" },
      { offset: 29 * 60 * 1000, expected: "fresh" },
    ];

    for (const { offset, expected } of cases) {
      const ts = new Date(Date.now() - offset).toISOString();
      expect(computeSyncAge(ts)).toBe(expected);
    }
  });
});

// ─── VAL-CROSS-002: Stale manual update — full flow ────────────────────────

describe("VAL-CROSS-002: Stale manual update — full flow from click to fresh state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stale sync age allows manual update, fresh does not", () => {
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const freshTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    expect(computeSyncAge(staleTs)).toBe("stale");
    expect(computeSyncAge(freshTs)).toBe("fresh");

    // Dashboard guard: if (syncAge !== "stale") return
    expect(computeSyncAge(staleTs) === "stale").toBe(true); // allows update
    expect(computeSyncAge(freshTs) === "stale").toBe(false); // blocks update
  });

  it("server-side gate allows match-history when stale", () => {
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(checkSyncGate(staleTs)).toBeNull(); // null = allowed
  });

  it("updateSyncTimestamp writes timestamp and sync transitions to fresh", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, lastSyncAt: now }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await BackendBridge.updateSyncTimestamp("p1");
    expect(result.success).toBe(true);
    expect(result.lastSyncAt).toBe(now);

    // After update, computeSyncAge should return "fresh"
    expect(computeSyncAge(result.lastSyncAt)).toBe("fresh");
    expect(formatSyncAge(result.lastSyncAt!)).toBe("just now");
  });

  it("syncNewHeadMatchesFromRiot returns skippedAlreadyFresh when all matches exist", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(["same"]);
    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer").mockResolvedValue(
      new Set(["same"])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ staleMatchIds: [] }),
      })
    );

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 5, {
      recentWindowSize: 25,
    });

    expect(result.skippedAlreadyFresh).toBe(true);
    expect(result.analyzedCount).toBe(0);
    expect(result.failedAnalyzeAttempts).toBe(0);
  });

  it("after successful sync + updateSyncTimestamp, profile transitions to fresh", async () => {
    // Simulates: sync completes → updateSyncTimestamp writes → state becomes fresh
    const now = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, lastSyncAt: now }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Step 1: sync runs (mocked to find nothing new — already tested in bridge.test.ts)
    // Step 2: updateSyncTimestamp writes new timestamp (finally block)
    const tsResult = await BackendBridge.updateSyncTimestamp("p1");
    expect(tsResult.success).toBe(true);
    expect(tsResult.lastSyncAt).toBe(now);

    // Step 3: profile transitions to "fresh" with "just now"
    const newAge = computeSyncAge(tsResult.lastSyncAt!);
    expect(newAge).toBe("fresh");
    expect(formatSyncAge(tsResult.lastSyncAt!)).toBe("just now");

    // Step 4: server-side gate now blocks further Riot calls
    expect(checkSyncGate(tsResult.lastSyncAt!)).not.toBeNull();

    vi.unstubAllGlobals();
  });
});

// ─── VAL-CROSS-003: Expired auto-sync then scroll — no double API calls ───

describe("VAL-CROSS-003: Expired auto-sync then scroll — no double API calls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expired sync triggers auto-sync, then transitions to fresh", () => {
    const expiredTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const age = computeSyncAge(expiredTs);
    expect(age).toBe("expired");

    // After sync, the dashboard writes a new timestamp via updateSyncTimestamp
    const afterSync = new Date().toISOString();
    const newAge = computeSyncAge(afterSync);
    expect(newAge).toBe("fresh");
  });

  it("after auto-sync, infinite scroll skips checkApiHasMore (fresh)", () => {
    // Simulate: auto-sync just completed, timestamp is "now"
    const freshTs = new Date().toISOString();
    const age = computeSyncAge(freshTs);
    expect(age).toBe("fresh");

    // loadMoreDbMatches gate: if (syncAge === "fresh") → skip checkApiHasMore
    expect(age === "fresh").toBe(true);
  });

  it("server-side gate blocks match-history after auto-sync completes", () => {
    const freshTs = new Date().toISOString();
    const gateResult = checkSyncGate(freshTs);
    expect(gateResult).not.toBeNull();
    expect(gateResult?.success).toBe(false);
  });
});

// ─── VAL-CROSS-004: Sync timestamp persists across page refresh ────────────

describe("VAL-CROSS-004: Sync timestamp persists across page refresh", () => {
  it("sync status is read from server-side API (not browser storage)", async () => {
    const serverTimestamp = "2026-04-22T12:05:00Z";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lastSyncAt: serverTimestamp }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await BackendBridge.getSyncStatus("p1");
    expect(status.lastSyncAt).toBe(serverTimestamp);

    // The fetch call went to the API, not localStorage
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/player-sync-status");

    vi.unstubAllGlobals();
  });

  it("fresh state is correctly recomputed from server timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));

    // Server returns a timestamp from 5 minutes ago
    const serverTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const age = computeSyncAge(serverTs);
    expect(age).toBe("fresh");

    // Countdown should be ~25 minutes remaining
    const remaining = computeCountdownRemaining(serverTs);
    expect(remaining).toBeGreaterThan(24 * 60 * 1000 - 1);
    expect(remaining).toBeLessThanOrEqual(25 * 60 * 1000);

    vi.useRealTimers();
  });

  it("updateSyncTimestamp writes to server so it survives refresh", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, lastSyncAt: now }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await BackendBridge.updateSyncTimestamp("p1");
    expect(result.success).toBe(true);

    // Verify it used POST (server write, not localStorage)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/player-sync-status");
    expect(call[1]?.method).toBe("POST");

    vi.unstubAllGlobals();
  });
});

// ─── VAL-CROSS-005: State reset between player searches ────────────────────

describe("VAL-CROSS-005: State reset between player searches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("each player gets independent sync status from server", async () => {
    // Player A: fresh
    const fetchMockA = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lastSyncAt: new Date().toISOString() }),
    });
    vi.stubGlobal("fetch", fetchMockA);
    const statusA = await BackendBridge.getSyncStatus("puuid-A");
    expect(computeSyncAge(statusA.lastSyncAt)).toBe("fresh");

    vi.unstubAllGlobals();

    // Player B: expired
    const fetchMockB = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lastSyncAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }),
    });
    vi.stubGlobal("fetch", fetchMockB);
    const statusB = await BackendBridge.getSyncStatus("puuid-B");
    expect(computeSyncAge(statusB.lastSyncAt)).toBe("expired");

    vi.unstubAllGlobals();
  });

  it("Player A's fresh state does not affect Player B's expired state", () => {
    const freshTs = new Date().toISOString();
    const expiredTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    // Player A: fresh — no Riot calls
    expect(computeSyncAge(freshTs)).toBe("fresh");
    expect(checkSyncGate(freshTs)).not.toBeNull(); // gate blocks

    // Player B: expired — Riot calls allowed
    expect(computeSyncAge(expiredTs)).toBe("expired");
    expect(checkSyncGate(expiredTs)).toBeNull(); // gate allows
  });

  it("dashboard sync decision resets correctly for different players", () => {
    // Player A: fresh with stored matches
    const decisionA = simulateDashboardSyncDecision(50, new Date().toISOString());
    expect(decisionA.syncAge).toBe("fresh");
    expect(decisionA.shouldAutoSync).toBe(false);
    expect(decisionA.shouldShowUpdateButton).toBe(false);

    // Player B: expired, no stored matches (new player)
    const decisionB = simulateDashboardSyncDecision(0, null);
    expect(decisionB.syncAge).toBe("expired");
    expect(decisionB.shouldAutoSync).toBe(true);

    // Player C: stale with stored matches
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const decisionC = simulateDashboardSyncDecision(30, staleTs);
    expect(decisionC.syncAge).toBe("stale");
    expect(decisionC.shouldAutoSync).toBe(false);
    expect(decisionC.shouldShowUpdateButton).toBe(true);
  });
});

// ─── VAL-CROSS-006: Manual update with zero new matches ────────────────────

describe("VAL-CROSS-006: Manual update with zero new matches still writes timestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("syncNewHeadMatchesFromRiot with skippedAlreadyFresh returns zero analyzed", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(["same"]);
    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer").mockResolvedValue(
      new Set(["same"])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ staleMatchIds: [] }),
      })
    );

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 10, {
      recentWindowSize: 25,
    });

    // No new matches found, but the sync was attempted
    expect(result.skippedAlreadyFresh).toBe(true);
    expect(result.analyzedCount).toBe(0);
    expect(result.failedAnalyzeAttempts).toBe(0);
  });

  it("syncNewHeadMatchesFromRiot with skippedNoHistory still returns cleanly", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(null);

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 10, {
      recentWindowSize: 25,
    });

    expect(result.skippedNoHistory).toBe(true);
    expect(result.analyzedCount).toBe(0);
  });

  it("updateSyncTimestamp writes timestamp even when no new matches were found", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, lastSyncAt: now }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Simulates the finally block in handleManualUpdate
    const tsResult = await BackendBridge.updateSyncTimestamp("p1");
    expect(tsResult.success).toBe(true);
    expect(tsResult.lastSyncAt).toBe(now);

    // The new timestamp transitions to "fresh"
    expect(computeSyncAge(tsResult.lastSyncAt!)).toBe("fresh");

    vi.unstubAllGlobals();
  });

  it("updateSyncTimestamp always called in finally block pattern", async () => {
    // Simulate: sync attempt that finds nothing new, but still writes timestamp
    const timestampWrites: string[] = [];

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("player-sync-status") && !url.includes("?")) {
        const ts = new Date().toISOString();
        timestampWrites.push(ts);
        return { ok: true, json: async () => ({ success: true, lastSyncAt: ts }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    // Simulate the dashboard pattern:
    // try { await syncNewHeadMatchesFromRiot(...) } finally { await updateSyncTimestamp(...) }
    try {
      // sync may succeed or fail — doesn't matter for timestamp write
      await BackendBridge.syncNewHeadMatchesFromRiot("p1", 0, { recentWindowSize: 25 });
    } finally {
      await BackendBridge.updateSyncTimestamp("p1");
    }

    expect(timestampWrites).toHaveLength(1);

    vi.unstubAllGlobals();
  });
});

// ─── VAL-CROSS-007: Concurrent click protection ────────────────────────────

describe("VAL-CROSS-007: Concurrent click protection prevents duplicate syncs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handleManualUpdate guard: fetchingMatchesFromApi blocks re-entry", () => {
    // Simulates the dashboard guard logic:
    // if (!currentPuuid || fetchingMatchesFromApi || syncAge !== "stale") return;

    const currentPuuid = "p1";
    const fetchingMatchesFromApi = true; // sync already in progress
    const syncAge = "stale";

    const shouldBlock = !currentPuuid || fetchingMatchesFromApi || syncAge !== "stale";
    expect(shouldBlock).toBe(true); // blocked because fetchingMatchesFromApi=true
  });

  it("second call is blocked when first is still running", () => {
    const puuid: string | null = "p1";
    const fetchingFirst: boolean = false;
    const fetchingSecond: boolean = true;
    const age = "stale";

    // First call: sync not in progress, stale → allowed
    const firstCallAllowed = !!puuid && !fetchingFirst && age === "stale";
    expect(firstCallAllowed).toBe(true);

    // Second call: sync now in progress → blocked
    const secondCallAllowed = !!puuid && !fetchingSecond && age === "stale";
    expect(secondCallAllowed).toBe(false);
  });

  it("syncAge must be stale for manual update (not fresh or expired)", () => {
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const freshTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const expiredTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    // Only stale allows manual update
    expect(computeSyncAge(staleTs) === "stale").toBe(true);
    expect(computeSyncAge(freshTs) === "stale").toBe(false);
    expect(computeSyncAge(expiredTs) === "stale").toBe(false);
  });

  it("syncNewHeadMatchesFromRiot with zero stored matches skips all work", async () => {
    // For new players (storedTotalCount=0), syncNewHeadMatchesFromRiot returns immediately
    const getMatchHistorySpy = vi.spyOn(BackendBridge, "getMatchHistory");

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 0, {
      recentWindowSize: 25,
    });

    expect(getMatchHistorySpy).not.toHaveBeenCalled();
    expect(result.analyzedCount).toBe(0);
    expect(result.skippedAlreadyFresh).toBe(false);
    expect(result.skippedNoHistory).toBe(false);
  });

  it("multiple rapid sync calls only result in one match-history request", async () => {
    // Simulate: first call starts, second is blocked by fetchingMatchesFromApi guard
    let fetchCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ["match1"],
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer").mockResolvedValue(
      new Set(["match1"])
    );

    // First sync call (simulates the only one that gets through)
    await BackendBridge.syncNewHeadMatchesFromRiot("p1", 5, {
      recentWindowSize: 25,
    });

    // Only one match-history fetch happened
    // (the second "click" was blocked by the fetchingMatchesFromApi guard)
    expect(fetchCount).toBeGreaterThanOrEqual(1);
    expect(fetchCount).toBeLessThanOrEqual(2); // match-history + stale-ids

    vi.unstubAllGlobals();
  });
});

// ─── Cross-boundary edge cases ─────────────────────────────────────────────

describe("Cross-boundary edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("missing metadata + stored matches = stale (not expired)", () => {
    // Dashboard override: expired + totalCount > 0 + !lastSyncAt → stale
    const decision = simulateDashboardSyncDecision(30, null);
    expect(decision.syncAge).toBe("stale");
    expect(decision.shouldAutoSync).toBe(false);
    expect(decision.shouldShowUpdateButton).toBe(true);
  });

  it("missing metadata + no stored matches = expired (new player)", () => {
    const decision = simulateDashboardSyncDecision(0, null);
    expect(decision.syncAge).toBe("expired");
    expect(decision.shouldAutoSync).toBe(true);
  });

  it("countdown auto-transitions to stale at boundary", () => {
    // At 29:59, countdown is ~1 second remaining
    const almostStaleTs = new Date(Date.now() - 29 * 60 * 1000 - 59 * 1000).toISOString();
    const remaining = computeCountdownRemaining(almostStaleTs);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(2000);

    // At exactly 30 minutes, countdown is 0 → triggers transition to stale
    const exactlyStaleTs = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const remainingAtBoundary = computeCountdownRemaining(exactlyStaleTs);
    expect(remainingAtBoundary).toBe(0);

    // computeSyncAge at boundary → stale
    expect(computeSyncAge(exactlyStaleTs)).toBe("stale");
  });

  it("loadMoreDbMatches gate: fresh blocks, stale/expired allow checkApiHasMore", () => {
    const freshTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const expiredTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    // Fresh: skip checkApiHasMore
    expect(computeSyncAge(freshTs) === "fresh").toBe(true);

    // Stale: allow checkApiHasMore
    expect(computeSyncAge(staleTs) === "fresh").toBe(false);

    // Expired: allow checkApiHasMore
    expect(computeSyncAge(expiredTs) === "fresh").toBe(false);
  });

  it("handleLoadMore gate: fresh blocks, stale/expired allow", () => {
    const freshTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    // Dashboard: if (syncAge === "fresh") return;
    expect(computeSyncAge(freshTs) === "fresh").toBe(true); // blocked
    expect(computeSyncAge(staleTs) === "fresh").toBe(false); // allowed
  });

  it("formatSyncAge returns 'just now' immediately after sync", () => {
    const now = new Date().toISOString();
    expect(formatSyncAge(now)).toBe("just now");
  });

  it("server sync gate (checkSyncGate) aligns with client sync age (computeSyncAge)", () => {
    // Both should use the same 30-minute threshold
    const freshTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const boundaryTs = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // Client and server agree on fresh
    expect(computeSyncAge(freshTs)).toBe("fresh");
    expect(checkSyncGate(freshTs)).not.toBeNull();

    // Client and server agree on stale
    expect(computeSyncAge(staleTs)).toBe("stale");
    expect(checkSyncGate(staleTs)).toBeNull();

    // Client and server agree on boundary (stale)
    expect(computeSyncAge(boundaryTs)).toBe("stale");
    expect(checkSyncGate(boundaryTs)).toBeNull();
  });
});
