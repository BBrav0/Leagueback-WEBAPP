import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSql = vi.fn();
const mockedPlayerRows = vi.fn();

vi.mock("@/lib/database-queries", () => ({
  getPlayerMatchRowsForStaleCheck: mockedPlayerRows,
}));

vi.mock("@/lib/neon", () => ({
  getSql: () => mockSql,
}));

vi.mock("@/lib/analytics-instrumentation", () => ({
  instrumentRoute: (_template: string, handler: any) => handler,
  analyticsNeonClient: () => ({ sql: vi.fn() }),
}));

describe("POST /api/player-matches/stale-ids", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // First call: sync metadata query
    mockSql.mockResolvedValueOnce([{
      derivation_version: "match-summary-v2",
      recent_match_window: 25,
      notes: {},
    }]);
    // Second call: match_cache query
    mockSql.mockResolvedValueOnce([
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
    ]);
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
    // Two sql calls: one for sync metadata, one for match_cache
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});
