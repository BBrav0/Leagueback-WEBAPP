import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendBridge } from "./bridge";
import type { MatchSummary } from "./types";

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

describe("BackendBridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getAccount returns parsed account on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ puuid: "p1", gameName: "A", tagLine: "NA1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const account = await BackendBridge.getAccount("A", "NA1");
    expect(account?.puuid).toBe("p1");
  });

  it("getAccount surfaces backend error message on non-ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Account not found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(BackendBridge.getAccount("A", "NA1")).rejects.toThrow(
      "Account not found"
    );
  });

  it("getStoredMatches returns safe fallback on backend error body", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await BackendBridge.getStoredMatches("p1", 20, 0);
    expect(result).toEqual({ matches: [], totalCount: 0, hasMore: false });
    errorSpy.mockRestore();
  });

  it("checkApiHasMore returns true when one id exists", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(["m1"]);
    const hasMore = await BackendBridge.checkApiHasMore("p1", 0);
    expect(hasMore).toBe(true);
  });

  it("getPlayerMatchDataBatch aggregates successful analyses", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(["m1", "m2"]);
    vi.spyOn(BackendBridge, "analyzeMatchPerformance")
      .mockResolvedValueOnce({ success: true, matchSummary: sampleMatch })
      .mockResolvedValueOnce({ success: false, error: "bad" });

    const result = await BackendBridge.getPlayerMatchDataBatch("p1", 0, 2, 0);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].id).toBe("m1");
    expect(result.hasMore).toBe(true);
    expect(result.nextStart).toBe(2);
  });

  it("getPlayerMatchDataBatch returns deterministic appended fixture matches without HTTP calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ["VALIDATION_APPEND_003", "VALIDATION_APPEND_004"],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await BackendBridge.getPlayerMatchDataBatch("validation-fixture-puuid", 0, 5, 0);

    expect(result.matches.map((match) => match.id)).toEqual([
      "VALIDATION_APPEND_003",
      "VALIDATION_APPEND_004",
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.nextStart).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/match-history?puuid=validation-fixture-puuid");
  });

  it("syncNewHeadMatchesFromRiot skips all Riot calls when player has no stored rows", async () => {
    const hist = vi.spyOn(BackendBridge, "getMatchHistory");

    const r = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 0, {
      recentWindowSize: 25,
    });

    expect(hist).not.toHaveBeenCalled();
    expect(r).toEqual({
      analyzedCount: 0,
      skippedAlreadyFresh: false,
      skippedNoHistory: false,
      failedAnalyzeAttempts: 0,
      refreshedStaleCount: 0,
      failedStaleRefreshAttempts: 0,
    });
  });

  it("syncNewHeadMatchesFromRiot fast path when ranked Riot head id already in DB", async () => {
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
    const analyze = vi.spyOn(BackendBridge, "analyzeMatchPerformance");

    const r = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 4, {
      recentWindowSize: 25,
    });

    expect(r.skippedAlreadyFresh).toBe(true);
    expect(r.analyzedCount).toBe(0);
    expect(r.failedAnalyzeAttempts).toBe(0);
    expect(r.refreshedStaleCount).toBe(0);
    expect(r.failedStaleRefreshAttempts).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("syncNewHeadMatchesFromRiot reconciles missing recent matches even when the latest Riot head already exists in DB", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory")
      .mockResolvedValueOnce(["head", "missing-recent", "anchor"])
      .mockResolvedValueOnce(["older-anchor"]);
    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer")
      .mockResolvedValueOnce(new Set(["head", "anchor"]))
      .mockResolvedValueOnce(new Set(["older-anchor"]));
    const analyze = vi
      .spyOn(BackendBridge, "analyzeMatchPerformance")
      .mockResolvedValue({ success: true, matchSummary: sampleMatch });

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 12, {
      recentWindowSize: 3,
      windowSize: 2,
      analyzeDelayMs: 0,
    });

    expect(result).toEqual({
      analyzedCount: 1,
      skippedAlreadyFresh: false,
      skippedNoHistory: false,
      failedAnalyzeAttempts: 0,
      refreshedStaleCount: 0,
      failedStaleRefreshAttempts: 0,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith("missing-recent", "p1");
  });

  it("syncNewHeadMatchesFromRiot analyzes only IDs before first anchor in window", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory")
      .mockResolvedValueOnce(["new1", "new2", "anchor"])
      .mockResolvedValueOnce(["older-anchor"]);
    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer")
      .mockResolvedValueOnce(new Set(["anchor"]))
      .mockResolvedValueOnce(new Set(["older-anchor"]));
    const analyze = vi
      .spyOn(BackendBridge, "analyzeMatchPerformance")
      .mockResolvedValue({ success: true, matchSummary: sampleMatch });

    const r = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 3, {
      recentWindowSize: 3,
      windowSize: 2,
      analyzeDelayMs: 0,
    });

    expect(r.analyzedCount).toBe(2);
    expect(r.failedAnalyzeAttempts).toBe(0);
    expect(r.skippedAlreadyFresh).toBe(false);
    expect(r.refreshedStaleCount).toBe(0);
    expect(r.failedStaleRefreshAttempts).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledWith("new1", "p1");
    expect(analyze).toHaveBeenCalledWith("new2", "p1");
  });

  it("syncNewHeadMatchesFromRiot refreshes stale recent rows when the Riot window is otherwise fully stored", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(["head", "stale-recent"]);
    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer").mockResolvedValue(
      new Set(["head", "stale-recent"])
    );
    const staleLookup = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ staleMatchIds: ["stale-recent"] }),
      } as Response);
    const analyze = vi
      .spyOn(BackendBridge, "analyzeMatchPerformance")
      .mockResolvedValue({ success: true, matchSummary: sampleMatch });

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 12, {
      recentWindowSize: 2,
      analyzeDelayMs: 0,
    });

    expect(result).toEqual({
      analyzedCount: 0,
      skippedAlreadyFresh: false,
      skippedNoHistory: false,
      failedAnalyzeAttempts: 0,
      refreshedStaleCount: 1,
      failedStaleRefreshAttempts: 0,
    });
    expect(staleLookup).toHaveBeenCalledWith(
      "http://127.0.0.1/api/player-matches/stale-ids",
      expect.objectContaining({ method: "POST" })
    );
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith("stale-recent", "p1");
  });

  it("syncNewHeadMatchesFromRiot treats multiple stale rows as independently detectable", async () => {
    vi.spyOn(BackendBridge, "getMatchHistory").mockResolvedValue(["head", "stale-a", "stale-b"]);
    vi.spyOn(BackendBridge, "fetchExistingMatchIdsForPlayer").mockResolvedValue(
      new Set(["head", "stale-a", "stale-b"])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ staleMatchIds: ["stale-a", "stale-b"] }),
      })
    );
    const analyze = vi
      .spyOn(BackendBridge, "analyzeMatchPerformance")
      .mockResolvedValue({ success: true, matchSummary: sampleMatch });

    const result = await BackendBridge.syncNewHeadMatchesFromRiot("p1", 12, {
      recentWindowSize: 3,
      analyzeDelayMs: 0,
    });

    expect(result.refreshedStaleCount).toBe(2);
    expect(result.failedStaleRefreshAttempts).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenNthCalledWith(1, "stale-a", "p1");
    expect(analyze).toHaveBeenNthCalledWith(2, "stale-b", "p1");
  });
});
