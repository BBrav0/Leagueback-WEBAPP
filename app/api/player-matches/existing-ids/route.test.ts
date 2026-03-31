import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedIn = vi.fn();
const mockedEq = vi.fn();
const mockedSelect = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServer: () => ({
    from: vi.fn(() => ({
      select: mockedSelect,
    })),
  }),
}));

describe("POST /api/player-matches/existing-ids", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockedIn.mockResolvedValue({
      data: [{ match_id: "NA1_1" }],
      error: null,
    });
    mockedEq.mockReturnValue({
      in: mockedIn,
    });
    mockedSelect.mockReturnValue({
      eq: mockedEq,
    });
  });

  it("filters malformed or empty match IDs before querying Supabase", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/player-matches/existing-ids", {
        method: "POST",
        body: JSON.stringify({
          puuid: "puuid-1",
          matchIds: ["NA1_1", "bad-match", "", " NA1_2 ", "   ", undefined],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      existingMatchIds: ["NA1_1"],
    });
    expect(mockedEq).toHaveBeenCalledWith("puuid", "puuid-1");
    expect(mockedIn).toHaveBeenCalledWith("match_id", ["NA1_1", "NA1_2"]);
  });

  it("returns an empty result when no valid match IDs are provided", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/player-matches/existing-ids", {
        method: "POST",
        body: JSON.stringify({
          puuid: "puuid-1",
          matchIds: ["bad-match", "", undefined, null],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      existingMatchIds: [],
    });
    expect(mockedIn).not.toHaveBeenCalled();
  });
});
