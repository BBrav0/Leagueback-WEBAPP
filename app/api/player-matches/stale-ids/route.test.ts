import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedMaybeSingle = vi.fn();
const mockedIn = vi.fn();
const mockedMatchCacheSelect = vi.fn();
const mockedPlayerRows = vi.fn();

vi.mock("@/lib/database-queries", () => ({
  getPlayerMatchRowsForStaleCheck: mockedPlayerRows,
}));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServer: () => ({
    from: vi.fn((table: string) => {
      if (table === "player_sync_metadata") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: mockedMaybeSingle,
            })),
          })),
        };
      }

      if (table === "match_cache") {
        return {
          select: mockedMatchCacheSelect,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  }),
}));

describe("POST /api/player-matches/stale-ids", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockedMaybeSingle.mockResolvedValue({
      data: {
        derivation_version: "match-summary-v2",
        recent_match_window: 25,
        notes: {},
      },
      error: null,
    });
    mockedIn.mockResolvedValue({
      data: [
        {
          match_id: "NA1_1",
          match_data: {
            info: {
              gameCreation: 100,
              gameDuration: 200,
            },
          },
        },
        {
          match_id: "NA1_2",
          match_data: {
            info: {
              gameCreation: 300,
              gameDuration: 400,
            },
          },
        },
      ],
      error: null,
    });
    mockedMatchCacheSelect.mockReturnValue({
      in: mockedIn,
    });
    mockedPlayerRows.mockResolvedValue([
      {
        match_id: "NA1_1",
        game_creation: 100,
        game_duration: 200,
        created_at: null,
      },
      {
        match_id: "NA1_2",
        game_creation: 301,
        game_duration: 400,
        created_at: null,
      },
    ]);
  });

  it("bulk-loads match_cache rows once and flags mismatched matches as stale", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/player-matches/stale-ids", {
        method: "POST",
        body: JSON.stringify({
          puuid: "puuid-1",
          matchIds: ["NA1_1", "NA1_2"],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      staleMatchIds: ["NA1_2"],
    });
    expect(mockedMatchCacheSelect).toHaveBeenCalledWith("match_id, match_data");
    expect(mockedIn).toHaveBeenCalledTimes(1);
    expect(mockedIn).toHaveBeenCalledWith("match_id", ["NA1_1", "NA1_2"]);
  });
});
