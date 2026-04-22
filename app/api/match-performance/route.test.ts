import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMatchDetails = vi.fn();
const getMatchTimeline = vi.fn();
const getCurrentRankEntries = vi.fn();
const reconstructMatchSummary = vi.fn();
const determineImpactCategory = vi.fn();
const getMatchCacheEntry = vi.fn();
const getPlayerSyncMetadata = vi.fn();
const getPlayerMatchRowsForStaleCheck = vi.fn();
const upsertPlayerMatch = vi.fn();
const upsertPlayerSyncMetadata = vi.fn();
const mockedSelectCurrentRankSnapshot = vi.fn();
const mockSql = vi.fn();

vi.mock("@/lib/riot-api-service", () => ({
  getMatchDetails,
  getMatchTimeline,
  getCurrentRankEntries,
}));

vi.mock("@/lib/match-reconstruction", () => ({
  reconstructMatchSummary,
  determineImpactCategory,
}));

vi.mock("@/lib/database-queries", () => ({
  getMatchCacheEntry,
  getPlayerSyncMetadata,
  getPlayerMatchRowsForStaleCheck,
  upsertPlayerMatch,
  upsertPlayerSyncMetadata,
}));

vi.mock("@/lib/rank-snapshot", () => ({
  selectCurrentRankSnapshot: mockedSelectCurrentRankSnapshot,
}));

vi.mock("@/lib/neon", () => ({
  getSql: () => mockSql,
}));

describe("GET /api/match-performance", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getMatchCacheEntry.mockResolvedValue({
      matchData: {
        info: {
          gameCreation: 1711785600000,
          gameDuration: 1800,
          participants: [
            {
              puuid: "puuid-1",
              summonerId: "summoner-1",
            },
          ],
        },
      },
      timelineData: { info: { frames: [] } },
    });
    getCurrentRankEntries.mockResolvedValue([]);
    mockedSelectCurrentRankSnapshot.mockReturnValue(null);
    reconstructMatchSummary.mockReturnValue({
      summonerName: "PlayerOne",
      champion: "Ahri",
      kda: "10/2/7",
      cs: 210,
      visionScore: 18,
      gameResult: "Victory",
      gameTime: "30:00",
      yourImpact: 7.2,
      teamImpact: 4.5,
      data: [],
      rank: null,
      rankLabel: "Current rank snapshot unavailable",
      rankQueue: null,
      role: "MIDDLE",
      damageToChampions: 24000,
    });
    determineImpactCategory.mockReturnValue("impactWins");
    upsertPlayerMatch.mockResolvedValue(null);
    getPlayerSyncMetadata.mockResolvedValue({
      recent_match_window: 25,
      notes: {},
      latest_db_match_created_at: null,
      latest_riot_match_created_at: null,
      latest_db_match_id: null,
      latest_riot_match_id: null,
      reconciled_through_match_created_at: 0,
      last_known_account_game_name: null,
      last_known_account_tag_line: null,
      last_full_refresh_at: null,
      last_riot_sync_at: null,
    });
    getPlayerMatchRowsForStaleCheck.mockResolvedValue([]);
    upsertPlayerSyncMetadata.mockResolvedValue(null);
  });

  it("surfaces sync metadata persistence failures in the response body", async () => {
    upsertPlayerSyncMetadata.mockResolvedValue("sync metadata write failed");

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_1&userPuuid=puuid-1"
      ) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      syncMetadataPersistError: "sync metadata write failed",
      syncMetadata: {
        recentMatchWindow: 25,
      },
    });
  });
});

describe("GET /api/match-performance — sync gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper: set up mocks for a cold-cache scenario so the sync gate is
   * the only thing standing between the request and the Riot API.
   */
  function setupColdCache() {
    getMatchCacheEntry.mockResolvedValue({
      matchData: null,
      timelineData: null,
    });
  }

  /**
   * Helper: set up mocks for a warm-cache scenario where Riot API is not
   * needed, so the sync gate should NOT block even for fresh players.
   */
  function setupWarmCache() {
    getMatchCacheEntry.mockResolvedValue({
      matchData: {
        info: {
          gameCreation: 1711785600000,
          gameDuration: 1800,
          participants: [{ puuid: "puuid-1", summonerId: "summoner-1" }],
        },
      },
      timelineData: { info: { frames: [] } },
    });
    reconstructMatchSummary.mockReturnValue({
      summonerName: "PlayerOne",
      champion: "Ahri",
      kda: "10/2/7",
      cs: 210,
      visionScore: 18,
      gameResult: "Victory",
      gameTime: "30:00",
      yourImpact: 7.2,
      teamImpact: 4.5,
      data: [],
      rank: null,
      rankLabel: "Current rank snapshot unavailable",
      rankQueue: null,
      role: "MIDDLE",
      damageToChampions: 24000,
    });
    determineImpactCategory.mockReturnValue("impactWins");
    upsertPlayerMatch.mockResolvedValue(null);
    getPlayerSyncMetadata.mockResolvedValue({
      recent_match_window: 25,
      notes: {},
      latest_db_match_created_at: null,
      latest_riot_match_created_at: null,
      latest_db_match_id: null,
      latest_riot_match_id: null,
      reconciled_through_match_created_at: 0,
      last_known_account_game_name: null,
      last_known_account_tag_line: null,
      last_full_refresh_at: null,
      last_riot_sync_at: null,
    });
    getPlayerMatchRowsForStaleCheck.mockResolvedValue([]);
    upsertPlayerSyncMetadata.mockResolvedValue(null);
    getCurrentRankEntries.mockResolvedValue([]);
    mockedSelectCurrentRankSnapshot.mockReturnValue(null);
  }

  it("returns 429 when cache is cold and player has fresh sync metadata", async () => {
    setupColdCache();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-fresh",
      last_riot_sync_at: fiveMinAgo,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_999&userPuuid=puuid-fresh"
      ) as never
    );

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Sync gate active");
    expect(body.gatedUntil).toBeDefined();
    // Riot API should never be called
    expect(getMatchDetails).not.toHaveBeenCalled();
    expect(getMatchTimeline).not.toHaveBeenCalled();
  });

  it("returns 429 when cache is cold and last_riot_sync_at is a Date within fresh window", async () => {
    setupColdCache();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-fresh-date",
      last_riot_sync_at: fiveMinAgo,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_999&userPuuid=puuid-fresh-date"
      ) as never
    );

    expect(response.status).toBe(429);
    expect(getMatchDetails).not.toHaveBeenCalled();
    expect(getMatchTimeline).not.toHaveBeenCalled();
  });

  it("allows request when cache is cold but sync metadata is stale", async () => {
    setupColdCache();
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-stale",
      last_riot_sync_at: staleTime,
      recent_match_window: 25,
      notes: {},
      latest_db_match_created_at: null,
      latest_riot_match_created_at: null,
      latest_db_match_id: null,
      latest_riot_match_id: null,
      reconciled_through_match_created_at: 0,
      last_known_account_game_name: null,
      last_known_account_tag_line: null,
      last_full_refresh_at: null,
    });
    getMatchDetails.mockResolvedValue({
      info: {
        gameCreation: 1711785600000,
        gameDuration: 1800,
        participants: [{ puuid: "puuid-stale", summonerId: "summoner-1" }],
      },
    });
    getMatchTimeline.mockResolvedValue({ info: { frames: [] } });
    getCurrentRankEntries.mockResolvedValue([]);
    mockedSelectCurrentRankSnapshot.mockReturnValue(null);
    reconstructMatchSummary.mockReturnValue({
      summonerName: "PlayerOne",
      champion: "Ahri",
      kda: "10/2/7",
      cs: 210,
      visionScore: 18,
      gameResult: "Victory",
      gameTime: "30:00",
      yourImpact: 7.2,
      teamImpact: 4.5,
      data: [],
      rank: null,
      rankLabel: "Current rank snapshot unavailable",
      rankQueue: null,
      role: "MIDDLE",
      damageToChampions: 24000,
    });
    determineImpactCategory.mockReturnValue("impactWins");
    upsertPlayerMatch.mockResolvedValue(null);
    getPlayerMatchRowsForStaleCheck.mockResolvedValue([]);
    upsertPlayerSyncMetadata.mockResolvedValue(null);
    mockSql.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_999&userPuuid=puuid-stale"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchDetails).toHaveBeenCalledWith("NA1_999");
    expect(getMatchTimeline).toHaveBeenCalledWith("NA1_999");
  });

  it("allows request when cache is cold but sync metadata is expired (24h+)", async () => {
    setupColdCache();
    const expiredTime = new Date(
      Date.now() - 25 * 60 * 60 * 1000
    ).toISOString();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-expired",
      last_riot_sync_at: expiredTime,
      recent_match_window: 25,
      notes: {},
      latest_db_match_created_at: null,
      latest_riot_match_created_at: null,
      latest_db_match_id: null,
      latest_riot_match_id: null,
      reconciled_through_match_created_at: 0,
      last_known_account_game_name: null,
      last_known_account_tag_line: null,
      last_full_refresh_at: null,
    });
    getMatchDetails.mockResolvedValue({
      info: {
        gameCreation: 1711785600000,
        gameDuration: 1800,
        participants: [{ puuid: "puuid-expired", summonerId: "summoner-1" }],
      },
    });
    getMatchTimeline.mockResolvedValue({ info: { frames: [] } });
    getCurrentRankEntries.mockResolvedValue([]);
    mockedSelectCurrentRankSnapshot.mockReturnValue(null);
    reconstructMatchSummary.mockReturnValue({
      summonerName: "PlayerOne",
      champion: "Ahri",
      kda: "10/2/7",
      cs: 210,
      visionScore: 18,
      gameResult: "Victory",
      gameTime: "30:00",
      yourImpact: 7.2,
      teamImpact: 4.5,
      data: [],
      rank: null,
      rankLabel: "Current rank snapshot unavailable",
      rankQueue: null,
      role: "MIDDLE",
      damageToChampions: 24000,
    });
    determineImpactCategory.mockReturnValue("impactWins");
    upsertPlayerMatch.mockResolvedValue(null);
    getPlayerMatchRowsForStaleCheck.mockResolvedValue([]);
    upsertPlayerSyncMetadata.mockResolvedValue(null);
    mockSql.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_999&userPuuid=puuid-expired"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchDetails).toHaveBeenCalledWith("NA1_999");
  });

  it("allows request when cache is cold and sync metadata is null (new player)", async () => {
    setupColdCache();
    getPlayerSyncMetadata.mockResolvedValue(null);
    getMatchDetails.mockResolvedValue({
      info: {
        gameCreation: 1711785600000,
        gameDuration: 1800,
        participants: [{ puuid: "puuid-new", summonerId: "summoner-1" }],
      },
    });
    getMatchTimeline.mockResolvedValue({ info: { frames: [] } });
    getCurrentRankEntries.mockResolvedValue([]);
    mockedSelectCurrentRankSnapshot.mockReturnValue(null);
    reconstructMatchSummary.mockReturnValue({
      summonerName: "PlayerOne",
      champion: "Ahri",
      kda: "10/2/7",
      cs: 210,
      visionScore: 18,
      gameResult: "Victory",
      gameTime: "30:00",
      yourImpact: 7.2,
      teamImpact: 4.5,
      data: [],
      rank: null,
      rankLabel: "Current rank snapshot unavailable",
      rankQueue: null,
      role: "MIDDLE",
      damageToChampions: 24000,
    });
    determineImpactCategory.mockReturnValue("impactWins");
    upsertPlayerMatch.mockResolvedValue(null);
    getPlayerMatchRowsForStaleCheck.mockResolvedValue([]);
    upsertPlayerSyncMetadata.mockResolvedValue(null);
    mockSql.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_999&userPuuid=puuid-new"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchDetails).toHaveBeenCalledWith("NA1_999");
  });

  it("allows request when cache is warm even if player has fresh sync", async () => {
    setupWarmCache();
    // Override the sync metadata to be fresh
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-1",
      last_riot_sync_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      recent_match_window: 25,
      notes: {},
      latest_db_match_created_at: null,
      latest_riot_match_created_at: null,
      latest_db_match_id: null,
      latest_riot_match_id: null,
      reconciled_through_match_created_at: 0,
      last_known_account_game_name: null,
      last_known_account_tag_line: null,
      last_full_refresh_at: null,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_1&userPuuid=puuid-1"
      ) as never
    );

    // Cache hit → sync gate never checked → proceeds normally
    expect(response.status).toBe(200);
    expect(getMatchDetails).not.toHaveBeenCalled();
    expect(getMatchTimeline).not.toHaveBeenCalled();
  });

  it("allows request when cache is cold and last_riot_sync_at is null", async () => {
    setupColdCache();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-null-sync",
      last_riot_sync_at: null,
      recent_match_window: 25,
      notes: {},
      latest_db_match_created_at: null,
      latest_riot_match_created_at: null,
      latest_db_match_id: null,
      latest_riot_match_id: null,
      reconciled_through_match_created_at: 0,
      last_known_account_game_name: null,
      last_known_account_tag_line: null,
      last_full_refresh_at: null,
    });
    getMatchDetails.mockResolvedValue({
      info: {
        gameCreation: 1711785600000,
        gameDuration: 1800,
        participants: [{ puuid: "puuid-null-sync", summonerId: "summoner-1" }],
      },
    });
    getMatchTimeline.mockResolvedValue({ info: { frames: [] } });
    getCurrentRankEntries.mockResolvedValue([]);
    mockedSelectCurrentRankSnapshot.mockReturnValue(null);
    reconstructMatchSummary.mockReturnValue({
      summonerName: "PlayerOne",
      champion: "Ahri",
      kda: "10/2/7",
      cs: 210,
      visionScore: 18,
      gameResult: "Victory",
      gameTime: "30:00",
      yourImpact: 7.2,
      teamImpact: 4.5,
      data: [],
      rank: null,
      rankLabel: "Current rank snapshot unavailable",
      rankQueue: null,
      role: "MIDDLE",
      damageToChampions: 24000,
    });
    determineImpactCategory.mockReturnValue("impactWins");
    upsertPlayerMatch.mockResolvedValue(null);
    getPlayerMatchRowsForStaleCheck.mockResolvedValue([]);
    upsertPlayerSyncMetadata.mockResolvedValue(null);
    mockSql.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_999&userPuuid=puuid-null-sync"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchDetails).toHaveBeenCalledWith("NA1_999");
  });

  it("returns 400 when required params are missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-performance?matchId=NA1_1"
      ) as never
    );

    expect(response.status).toBe(400);
  });
});
