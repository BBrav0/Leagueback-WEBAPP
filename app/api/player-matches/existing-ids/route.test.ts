import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSql = vi.fn();

vi.mock("@/lib/neon", () => ({
  getSql: () => mockSql,
}));

describe("POST /api/player-matches/existing-ids", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockSql.mockResolvedValue([{ match_id: "NA1_1" }]);
  });

  it("filters malformed or empty match IDs before querying the database", async () => {
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
    expect(mockSql).not.toHaveBeenCalled();
  });
});
