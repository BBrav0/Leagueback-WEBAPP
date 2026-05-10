import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlayerMatchesPaginated = vi.fn();

vi.mock("@/lib/database-queries", () => ({
  getPlayerMatchesPaginated,
}));

vi.mock("@/lib/validation-fixture", () => ({
  VALIDATION_FIXTURE_ACCOUNT: { puuid: "__fixture_puuid__" },
  getValidationFixtureStoredMatches: vi.fn(),
}));

vi.mock("@/lib/analytics-instrumentation", () => ({
  instrumentRoute: (_template: string, handler: any) => handler,
  analyticsNeonClient: () => ({ sql: vi.fn() }),
}));

vi.mock("@/lib/neon", () => ({
  getSql: () => vi.fn(),
}));

describe("GET /api/stored-matches", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns stored matches with readFailed=false when the database read succeeds", async () => {
    getPlayerMatchesPaginated.mockResolvedValue({
      matches: [{ id: "NA1_1" }],
      totalCount: 1,
      hasMore: false,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stored-matches?puuid=puuid-1&limit=20&offset=0") as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: [{ id: "NA1_1" }],
      totalCount: 1,
      hasMore: false,
      readFailed: false,
    });
  });

  it("returns readFailed=true with a 500 status when the database read throws", async () => {
    getPlayerMatchesPaginated.mockRejectedValue(new Error("db unavailable"));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stored-matches?puuid=puuid-1&limit=20&offset=0") as never
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      matches: [],
      totalCount: 0,
      hasMore: false,
      readFailed: true,
      error: "db unavailable",
    });
  });
});
