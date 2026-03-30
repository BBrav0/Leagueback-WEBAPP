import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedSingle = vi.fn();
const mockedMaybeSingle = vi.fn();
const mockedIlikeTag = vi.fn();
const mockedIlikeName = vi.fn();
const mockedSelect = vi.fn();
const mockedUpsert = vi.fn();
const mockedFrom = vi.fn();

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

      throw new Error(`Unexpected table: ${table}`);
    });

    mockedSelect.mockReturnValue({ ilike: mockedIlikeName });
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

      throw new Error(`Unexpected select columns: ${columns}`);
    });
    mockedUpsert.mockResolvedValue({ error: null });
    mockedMaybeSingle.mockResolvedValue({ data: null, error: null });
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
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/summoner/by-puuid/puuid-1")
    );
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        puuid: "puuid-1",
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        puuid: "puuid-1",
        summoner_id: "cached-by-puuid-summoner-id",
      })
    );
  });
});
