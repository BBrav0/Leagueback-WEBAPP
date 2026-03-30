import { describe, expect, it, vi, beforeEach } from "vitest";
import { VALIDATION_FIXTURE_ACCOUNT } from "@/lib/validation-fixture";

const getMatchDetailsData = vi.fn();

vi.mock("@/lib/database-queries", () => ({
  getMatchDetailsData,
}));

describe("GET /api/match-details", () => {
  beforeEach(() => {
    getMatchDetailsData.mockReset();
  });

  it("returns match details for a valid request", async () => {
    getMatchDetailsData.mockResolvedValue({
      matchId: "NA1_1",
      status: "ready",
      statusLabel: "Full match details loaded from cached raw match data.",
      fallbackReason: "none",
      source: "match_cache",
      teams: [],
      participants: [],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/match-details?matchId=NA1_1&userPuuid=puuid-1") as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      details: {
        matchId: "NA1_1",
        status: "ready",
        statusLabel: "Full match details loaded from cached raw match data.",
        fallbackReason: "none",
        source: "match_cache",
        teams: [],
        participants: [],
      },
    });
    expect(getMatchDetailsData).toHaveBeenCalledWith("NA1_1", "puuid-1");
  });

  it("returns 400 when required params are missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/match-details?matchId=NA1_1") as never
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing matchId or userPuuid",
    });
  });

  it("returns fixture details through the runtime route without hitting the database helper", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        `http://localhost/api/match-details?matchId=VALIDATION_READY_001&userPuuid=${VALIDATION_FIXTURE_ACCOUNT.puuid}`
      ) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        matchId: "VALIDATION_READY_001",
        status: "ready",
      },
    });
    expect(getMatchDetailsData).not.toHaveBeenCalled();
  });
});
