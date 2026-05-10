import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMatchHistory = vi.fn();
const getPlayerSyncMetadata = vi.fn();

vi.mock("@/lib/riot-api-service", () => ({
  getMatchHistory,
}));

vi.mock("@/lib/database-queries", () => ({
  getPlayerSyncMetadata,
}));

// Mock validation-fixture so the fixture puuid check doesn't interfere.
vi.mock("@/lib/validation-fixture", () => ({
  VALIDATION_FIXTURE_ACCOUNT: { puuid: "__fixture_puuid__" },
  getValidationFixtureMatchHistory: () => ["FIXTURE_MATCH"],
}));

vi.mock("@/lib/analytics-instrumentation", () => ({
  instrumentRoute: (_template: string, handler: any) => handler,
}));

vi.mock("@/lib/neon", () => ({
  getSql: () => vi.fn(),
}));

describe("GET /api/match-history — sync gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 429 when puuid has fresh sync metadata", async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-fresh",
      last_riot_sync_at: fiveMinAgo,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=puuid-fresh&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Sync gate active");
    expect(body.gatedUntil).toBeDefined();
    // Riot API should never be called
    expect(getMatchHistory).not.toHaveBeenCalled();
  });

  it("returns 429 when last_riot_sync_at is a Date object within fresh window", async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-fresh-date",
      last_riot_sync_at: fiveMinAgo,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=puuid-fresh-date&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(429);
    expect(getMatchHistory).not.toHaveBeenCalled();
  });

  it("allows request and calls Riot API when sync metadata is stale", async () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-stale",
      last_riot_sync_at: staleTime,
    });
    getMatchHistory.mockResolvedValue(["NA1_123", "NA1_456"]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=puuid-stale&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(["NA1_123", "NA1_456"]);
    expect(getMatchHistory).toHaveBeenCalledWith("puuid-stale", 10, 0);
  });

  it("allows request when sync metadata is expired (24h+)", async () => {
    const expiredTime = new Date(
      Date.now() - 25 * 60 * 60 * 1000
    ).toISOString();
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-expired",
      last_riot_sync_at: expiredTime,
    });
    getMatchHistory.mockResolvedValue(["NA1_789"]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=puuid-expired&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchHistory).toHaveBeenCalledWith("puuid-expired", 10, 0);
  });

  it("allows request when sync metadata is null (no prior sync)", async () => {
    getPlayerSyncMetadata.mockResolvedValue(null);
    getMatchHistory.mockResolvedValue(["NA1_000"]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=puuid-new&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchHistory).toHaveBeenCalledWith("puuid-new", 10, 0);
  });

  it("allows request when sync metadata exists but last_riot_sync_at is null", async () => {
    getPlayerSyncMetadata.mockResolvedValue({
      puuid: "puuid-null-sync",
      last_riot_sync_at: null,
    });
    getMatchHistory.mockResolvedValue(["NA1_111"]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=puuid-null-sync&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(getMatchHistory).toHaveBeenCalledWith("puuid-null-sync", 10, 0);
  });

  it("returns 400 when puuid is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/match-history?count=10&start=0") as never
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Missing puuid");
  });

  it("bypasses sync gate for validation fixture puuid", async () => {
    getMatchHistory.mockResolvedValue(["FIXTURE_FROM_MOCK"]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/match-history?puuid=__fixture_puuid__&count=10&start=0"
      ) as never
    );

    expect(response.status).toBe(200);
    // Fixture path returns fixture data directly, not through Riot API
    expect(getPlayerSyncMetadata).not.toHaveBeenCalled();
  });
});


