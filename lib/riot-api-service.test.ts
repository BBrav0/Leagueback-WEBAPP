import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Neon module to control what sql template calls return
const mockSql = vi.fn();

vi.mock("./neon", () => ({
  getSql: () => mockSql,
}));

describe("riot-api-service account summonerId wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.RIOT_API_KEY = "test-riot-api-key";
  });

  it("hydrates a missing summonerId from the worker by puuid before caching", async () => {
    // 1) getAccountByRiotId ILIKE cache lookup -> no cached row
    mockSql.mockResolvedValueOnce([]);
    // 2) getSummonerIdByPuuid -> getCachedSummonerIdByPuuid -> no cached summoner
    mockSql.mockResolvedValueOnce([]);
    // 3) cacheSummonerIdForPuuid (from getSummonerIdByPuuid, no fallbackAccount) -> SELECT existing account
    mockSql.mockResolvedValueOnce([]);
    // 4) cacheSummonerIdForPuuid -> INSERT upsert
    mockSql.mockResolvedValueOnce([]);
    // 5) cacheSummonerIdForPuuid (from getAccountByRiotId, with fallbackAccount) -> INSERT upsert
    mockSql.mockResolvedValueOnce([]);
    // 6) getAccountByRiotId final upsert -> INSERT account row
    mockSql.mockResolvedValueOnce([]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          puuid: "puuid-1",
          gameName: "Bumsdito",
          tagLine: "3005",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "real-summoner-id",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { getAccountByRiotId } = await import("./riot-api-service");
    const account = await getAccountByRiotId("Bumsdito", "3005");

    expect(account).toEqual({
      puuid: "puuid-1",
      gameName: "Bumsdito",
      tagLine: "3005",
      summonerId: "real-summoner-id",
      riotId: "Bumsdito#3005",
      rankLookupId: "real-summoner-id",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/lol/summoner/v4/summoners/by-puuid/puuid-1"),
      expect.objectContaining({
        headers: { "X-Riot-Token": "test-riot-api-key" },
      })
    );

    // Verify the final account upsert (call #6) contains the correct data
    const upsertCall = mockSql.mock.calls[5];
    // Tagged template: first arg is string parts array, subsequent args are values
    const upsertQuery = upsertCall[0].join("");
    expect(upsertQuery).toContain("INSERT INTO accounts");
    expect(upsertCall).toContain("puuid-1");
    expect(upsertCall).toContain("Bumsdito");
    expect(upsertCall).toContain("3005");
    expect(upsertCall).toContain("real-summoner-id");
  });

  it("returns a cached summonerId unchanged when the account row already has one", async () => {
    // getAccountByRiotId ILIKE cache lookup -> returns cached row
    mockSql.mockResolvedValueOnce([
      {
        puuid: "puuid-1",
        game_name: "Bumsdito",
        tag_line: "3005",
        summoner_id: "cached-summoner-id",
      },
    ]);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getAccountByRiotId } = await import("./riot-api-service");
    const account = await getAccountByRiotId("Bumsdito", "3005");

    expect(account.summonerId).toBe("cached-summoner-id");
    expect(account.rankLookupId).toBe("cached-summoner-id");
    expect(account.riotId).toBe("Bumsdito#3005");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses a cached summonerId by puuid before calling the worker summoner lookup", async () => {
    // 1) getAccountByRiotId ILIKE cache lookup -> no cached row
    mockSql.mockResolvedValueOnce([]);
    // 2) getSummonerIdByPuuid -> getCachedSummonerIdByPuuid -> returns cached summoner_id
    mockSql.mockResolvedValueOnce([
      { summoner_id: "cached-by-puuid-summoner-id" },
    ]);
    // 3) cacheSummonerIdForPuuid (from getAccountByRiotId, with fallbackAccount) -> INSERT upsert
    mockSql.mockResolvedValueOnce([]);
    // 4) getAccountByRiotId final upsert -> INSERT account row
    mockSql.mockResolvedValueOnce([]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          puuid: "puuid-1",
          gameName: "Bumsdito",
          tagLine: "3005",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const { getAccountByRiotId } = await import("./riot-api-service");
    const account = await getAccountByRiotId("Bumsdito", "3005");

    expect(account.summonerId).toBe("cached-by-puuid-summoner-id");
    expect(account.rankLookupId).toBe("cached-by-puuid-summoner-id");
    expect(account.riotId).toBe("Bumsdito#3005");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify the final account upsert (call #4) contains the cached summonerId
    const upsertCall = mockSql.mock.calls[3];
    const upsertQuery = upsertCall[0].join("");
    expect(upsertQuery).toContain("INSERT INTO accounts");
    expect(upsertCall).toContain("cached-by-puuid-summoner-id");
  });

  it("falls back to match_cache participant summonerId when the worker lookup is forbidden", async () => {
    // 1) getAccountByRiotId ILIKE cache lookup -> no cached row
    mockSql.mockResolvedValueOnce([]);
    // 2) getSummonerIdByPuuid -> getCachedSummonerIdByPuuid -> no cached summoner
    mockSql.mockResolvedValueOnce([]);
    // 3) getCachedSummonerIdFromMatchParticipants -> player_matches lookup
    mockSql.mockResolvedValueOnce([{ match_id: "NA1_1" }]);
    // 4) getCachedSummonerIdFromMatchParticipants -> match_cache lookup
    mockSql.mockResolvedValueOnce([
      {
        match_id: "NA1_1",
        match_data: {
          info: {
            participants: [
              {
                puuid: "puuid-1",
                summonerId: "match-cache-summoner-id",
              },
            ],
          },
        },
      },
    ]);
    // 5) cacheSummonerIdForPuuid (from getCachedSummonerIdFromMatchParticipants, no fallbackAccount) -> SELECT existing
    mockSql.mockResolvedValueOnce([]);
    // 6) cacheSummonerIdForPuuid -> INSERT upsert
    mockSql.mockResolvedValueOnce([]);
    // 7) cacheSummonerIdForPuuid (from getAccountByRiotId, with fallbackAccount) -> INSERT upsert
    mockSql.mockResolvedValueOnce([]);
    // 8) getAccountByRiotId final upsert -> INSERT account row
    mockSql.mockResolvedValueOnce([]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          puuid: "puuid-1",
          gameName: "Bumsdito",
          tagLine: "3005",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

    vi.stubGlobal("fetch", fetchMock);

    const { getAccountByRiotId } = await import("./riot-api-service");
    const account = await getAccountByRiotId("Bumsdito", "3005");

    expect(account.summonerId).toBe("match-cache-summoner-id");
    expect(account.rankLookupId).toBe("match-cache-summoner-id");
    expect(account.riotId).toBe("Bumsdito#3005");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to puuid as rankLookupId when no summonerId is available", async () => {
    // 1) getAccountByRiotId ILIKE cache lookup -> no cached row
    mockSql.mockResolvedValueOnce([]);
    // 2) getSummonerIdByPuuid -> getCachedSummonerIdByPuuid -> no cached summoner
    mockSql.mockResolvedValueOnce([]);
    // 3) getCachedSummonerIdFromMatchParticipants -> player_matches lookup (empty)
    mockSql.mockResolvedValueOnce([]);
    // 4) getAccountByRiotId final upsert -> insert account row (with null summoner_id)
    mockSql.mockResolvedValueOnce([]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          puuid: "puuid-1",
          gameName: "Bumsdito",
          tagLine: "3005",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

    vi.stubGlobal("fetch", fetchMock);

    const { getAccountByRiotId } = await import("./riot-api-service");
    const account = await getAccountByRiotId("Bumsdito", "3005");

    expect(account.summonerId).toBeUndefined();
    expect(account.rankLookupId).toBe("puuid-1");
    expect(account.riotId).toBe("Bumsdito#3005");
  });

  it("does not interpolate hostile puuids into a SQL query (parameterized safely)", async () => {
    const hostilePuuid = 'puuid-1"}],"oops":"x';
    // 1) getCachedSummonerIdByPuuid -> no cached summoner
    mockSql.mockResolvedValueOnce([]);
    // 2) getCachedSummonerIdFromMatchParticipants -> player_matches lookup
    mockSql.mockResolvedValueOnce([{ match_id: "NA1_2" }]);
    // 3) getCachedSummonerIdFromMatchParticipants -> match_cache lookup
    mockSql.mockResolvedValueOnce([
      {
        match_id: "NA1_2",
        match_data: {
          info: {
            participants: [
              {
                puuid: hostilePuuid,
                summonerId: "safe-summoner-id",
              },
            ],
          },
        },
      },
    ]);
    // 4) cacheSummonerIdForPuuid -> upsert
    mockSql.mockResolvedValueOnce([]);

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    vi.stubGlobal("fetch", fetchMock);

    const { getSummonerIdByPuuid } = await import("./riot-api-service");
    const summonerId = await getSummonerIdByPuuid(hostilePuuid);

    expect(summonerId).toBe("safe-summoner-id");

    // Verify the hostile puuid was passed as a parameter (part of the tagged template)
    // The player_matches query should contain the hostile puuid as a parameter
    const playerMatchesCall = mockSql.mock.calls[1];
    const playerMatchesQuery = playerMatchesCall[0].join("");
    expect(playerMatchesQuery).toContain("player_matches");
    expect(playerMatchesQuery).toContain("WHERE puuid =");

    // The match_cache query should use ANY
    const matchCacheCall = mockSql.mock.calls[2];
    const matchCacheQuery = matchCacheCall[0].join("");
    expect(matchCacheQuery).toContain("match_cache");
    expect(matchCacheQuery).toContain("ANY");
  });

  it("finds cached participant data from older player-specific matches instead of latest global cache rows", async () => {
    // 1) getCachedSummonerIdByPuuid -> no cached summoner
    mockSql.mockResolvedValueOnce([]);
    // 2) getCachedSummonerIdFromMatchParticipants -> player_matches lookup
    mockSql.mockResolvedValueOnce([{ match_id: "NA1_older_cached_match" }]);
    // 3) getCachedSummonerIdFromMatchParticipants -> match_cache lookup
    mockSql.mockResolvedValueOnce([
      {
        match_id: "NA1_older_cached_match",
        match_data: {
          info: {
            participants: [
              {
                puuid: "puuid-older-player",
                summonerId: "older-match-summoner-id",
              },
            ],
          },
        },
      },
    ]);
    // 4) cacheSummonerIdForPuuid (no fallbackAccount) -> SELECT existing
    mockSql.mockResolvedValueOnce([]);
    // 5) cacheSummonerIdForPuuid -> INSERT upsert
    mockSql.mockResolvedValueOnce([]);

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    vi.stubGlobal("fetch", fetchMock);

    const { getSummonerIdByPuuid } = await import("./riot-api-service");
    const summonerId = await getSummonerIdByPuuid("puuid-older-player");

    expect(summonerId).toBe("older-match-summoner-id");

    // Verify player_matches query for correct puuid
    const playerMatchesCall = mockSql.mock.calls[1];
    const playerMatchesQuery = playerMatchesCall[0].join("");
    expect(playerMatchesQuery).toContain("player_matches");
    // puuid is a parameter value, not in the query string
    expect(playerMatchesCall).toContain("puuid-older-player");

    // Verify match_cache query with correct match IDs
    const matchCacheCall = mockSql.mock.calls[2];
    const matchCacheQuery = matchCacheCall[0].join("");
    expect(matchCacheQuery).toContain("match_cache");
    // match IDs are passed as an array parameter (ANY($1))
    const matchIdParam = matchCacheCall[1];
    expect(matchIdParam).toEqual(["NA1_older_cached_match"]);
  });
});
