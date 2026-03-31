import { beforeEach, describe, expect, it, vi } from "vitest";

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
const mockedSupabaseUpsert = vi.fn();

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

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServer: () => ({
    from: vi.fn(() => ({
      upsert: mockedSupabaseUpsert,
    })),
  }),
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
    mockedSupabaseUpsert.mockResolvedValue({ error: null });
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
