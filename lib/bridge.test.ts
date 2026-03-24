import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendBridge } from "./bridge";
import type { MatchSummary } from "./types";

const sampleMatch: MatchSummary = {
  id: "m1",
  summonerName: "PlayerOne",
  champion: "Ahri",
  rank: "Gold",
  kda: "5/2/9",
  cs: 180,
  visionScore: 20,
  gameResult: "Victory",
  gameTime: "25:15",
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
});
