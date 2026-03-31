import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedSingle = vi.fn();
const mockedMaybeSingle = vi.fn();
const mockedIlikeTag = vi.fn();
const mockedIlikeName = vi.fn();
const mockedSelect = vi.fn();
const mockedUpsert = vi.fn();
const mockedFrom = vi.fn();
const mockedPlayerMatchesEq = vi.fn();
const mockedPlayerMatchesOrder = vi.fn();
const mockedPlayerMatchesLimit = vi.fn();
const mockedMatchCacheIn = vi.fn();

vi.mock("./supabase-server", () => ({
  getSupabaseServer: () => ({
    from: mockedFrom,
  }),
}));

describe("riot-api-service account summonerId wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockedFrom.mockImplementation((table: string) => {
      if (table === "accounts") {
        return {
          select: mockedSelect,
          upsert: mockedUpsert,
        };
      }

      if (table === "player_matches") {
        return {
          select: mockedSelect,
        };
      }

      if (table === "match_cache") {
        return {
          select: mockedSelect,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockedIlikeName.mockReturnValue({ ilike: mockedIlikeTag });
    mockedIlikeTag.mockReturnValue({ single: mockedSingle });
    mockedSelect.mockImplementation((columns: string) => {
      if (columns === "puuid, game_name, tag_line, summoner_id") {
        return { ilike: mockedIlikeName };
      }

      if (columns === "summoner_id") {
        return {
          eq: vi.fn().mockReturnValue({
            maybeSingle: mockedMaybeSingle,
          }),
        };
      }

      if (columns === "game_name, tag_line") {
        return {
          eq: vi.fn().mockReturnValue({
            maybeSingle: mockedMaybeSingle,
          }),
        };
      }

      if (columns === "match_data") {
        return {
          in: mockedMatchCacheIn,
        };
      }

      if (columns === "match_id, match_data") {
        return {
          in: mockedMatchCacheIn,
        };
      }

      if (columns === "match_id") {
        return {
          eq: mockedPlayerMatchesEq,
        };
      }

      throw new Error(`Unexpected select columns: ${columns}`);
    });
    mockedUpsert.mockResolvedValue({ error: null });
    mockedMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockedPlayerMatchesEq.mockReturnValue({
      order: mockedPlayerMatchesOrder,
    });
    mockedPlayerMatchesOrder.mockReturnValue({
      limit: mockedPlayerMatchesLimit,
    });
    mockedPlayerMatchesLimit.mockResolvedValue({ data: [], error: null });
    mockedMatchCacheIn.mockResolvedValue({ data: [], error: null });
  });

  it("hydrates a missing summonerId from the worker by puuid before caching", async () => {
    mockedSingle.mockResolvedValueOnce({ data: null });

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
      expect.stringContaining("/api/summoner/by-puuid/puuid-1")
    );
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        puuid: "puuid-1",
        game_name: "Bumsdito",
        tag_line: "3005",
        summoner_id: "real-summoner-id",
      })
    );
  });

  it("returns a cached summonerId unchanged when the account row already has one", async () => {
    mockedSingle.mockResolvedValueOnce({
      data: {
        puuid: "puuid-1",
        game_name: "Bumsdito",
        tag_line: "3005",
        summoner_id: "cached-summoner-id",
      },
    });

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
    mockedSingle.mockResolvedValueOnce({ data: null });
    mockedMaybeSingle.mockResolvedValueOnce({
      data: {
        summoner_id: "cached-by-puuid-summoner-id",
      },
      error: null,
    });

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
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        puuid: "puuid-1",
        game_name: "Bumsdito",
        tag_line: "3005",
        summoner_id: "cached-by-puuid-summoner-id",
      })
    );
  });

  it("falls back to match_cache participant summonerId when the worker lookup is forbidden", async () => {
    mockedSingle.mockResolvedValueOnce({ data: null });
    mockedPlayerMatchesLimit.mockResolvedValueOnce({
      data: [{ match_id: "NA1_1" }],
      error: null,
    });
    mockedMatchCacheIn.mockResolvedValueOnce({
      data: [
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
      ],
      error: null,
    });

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
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        puuid: "puuid-1",
        game_name: "Bumsdito",
        tag_line: "3005",
        summoner_id: "match-cache-summoner-id",
      }),
      expect.anything()
    );
  });

  it("falls back to puuid as rankLookupId when no summonerId is available", async () => {
    mockedSingle.mockResolvedValueOnce({ data: null });

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

  it("does not interpolate hostile puuids into a PostgREST JSON filter", async () => {
    const hostilePuuid = 'puuid-1"}],"oops":"x';
    mockedMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockedPlayerMatchesLimit.mockResolvedValueOnce({
      data: [{ match_id: "NA1_2" }],
      error: null,
    });
    mockedMatchCacheIn.mockResolvedValueOnce({
      data: [
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
      ],
      error: null,
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    vi.stubGlobal("fetch", fetchMock);

    const { getSummonerIdByPuuid } = await import("./riot-api-service");
    const summonerId = await getSummonerIdByPuuid(hostilePuuid);

    expect(summonerId).toBe("safe-summoner-id");
    expect(mockedPlayerMatchesEq).toHaveBeenCalledWith("puuid", hostilePuuid);
    expect(mockedPlayerMatchesOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mockedPlayerMatchesLimit).toHaveBeenCalledWith(25);
    expect(mockedMatchCacheIn).toHaveBeenCalledWith("match_id", ["NA1_2"]);
  });

  it("finds cached participant data from older player-specific matches instead of latest global cache rows", async () => {
    mockedMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockedPlayerMatchesLimit.mockResolvedValueOnce({
      data: [{ match_id: "NA1_older_cached_match" }],
      error: null,
    });
    mockedMatchCacheIn.mockResolvedValueOnce({
      data: [
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
      ],
      error: null,
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    vi.stubGlobal("fetch", fetchMock);

    const { getSummonerIdByPuuid } = await import("./riot-api-service");
    const summonerId = await getSummonerIdByPuuid("puuid-older-player");

    expect(summonerId).toBe("older-match-summoner-id");
    expect(mockedPlayerMatchesEq).toHaveBeenCalledWith("puuid", "puuid-older-player");
    expect(mockedMatchCacheIn).toHaveBeenCalledWith("match_id", ["NA1_older_cached_match"]);
  });
});
