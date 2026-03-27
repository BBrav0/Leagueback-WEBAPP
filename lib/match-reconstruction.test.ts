import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MatchDto, MatchTimelineDto } from "./types";
import {
  determineImpactCategory,
  reconstructMatchSummary,
} from "./match-reconstruction";
import { generateChartData } from "./performance-calculation";

vi.mock("./performance-calculation", () => ({
  generateChartData: vi.fn(),
}));

const mockedGenerateChartData = vi.mocked(generateChartData);

function makeMatchDetails(): MatchDto {
  return {
    info: {
      participants: [
        {
          summonerName: "PlayerOne",
          championName: "Ahri",
          visionScore: 18,
          kills: 10,
          deaths: 2,
          assists: 7,
          totalDamageDealtToChampions: 10000,
          teamId: 100,
          puuid: "user-1",
          participantId: 1,
          teamPosition: "MIDDLE",
        },
      ],
      teams: [{ teamId: 100, win: true }],
      gameDuration: 125,
      gameCreation: 0,
    },
  };
}

function makeTimeline(): MatchTimelineDto {
  return {
    info: {
      frames: [
        {
          timestamp: 0,
          participantFrames: {
            "1": {
              participantId: 1,
              totalGold: 1200,
              minionsKilled: 80,
              jungleMinionsKilled: 12,
              level: 10,
              damageStats: { totalDamageDoneToChampions: 1000 },
            },
          },
          events: [],
        },
      ],
    },
  };
}

describe("determineImpactCategory", () => {
  it("returns all expected categories", () => {
    expect(determineImpactCategory("Victory", 10, 5)).toBe("impactWins");
    expect(determineImpactCategory("Defeat", 3, 8)).toBe("impactLosses");
    expect(determineImpactCategory("Victory", 5, 8)).toBe("guaranteedWins");
    expect(determineImpactCategory("Defeat", 8, 3)).toBe("guaranteedLosses");
  });

  it("uses non-higher branch for ties", () => {
    expect(determineImpactCategory("Victory", 6, 6)).toBe("guaranteedWins");
    expect(determineImpactCategory("Defeat", 6, 6)).toBe("impactLosses");
  });
});

describe("reconstructMatchSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when user participant is missing", () => {
    const details = makeMatchDetails();
    const timeline = makeTimeline();
    expect(() =>
      reconstructMatchSummary("m-1", "missing-user", details, timeline)
    ).toThrow("User not found in match");
  });

  it("reconstructs summary fields and strips minute -1 data", () => {
    mockedGenerateChartData.mockReturnValue([
      { minute: -1, yourImpact: 7.3, teamImpact: 4.2 },
      { minute: 5, yourImpact: 1.1, teamImpact: 0.9 },
      { minute: 10, yourImpact: 2.2, teamImpact: 1.3 },
    ]);

    const summary = reconstructMatchSummary(
      "m-42",
      "user-1",
      makeMatchDetails(),
      makeTimeline()
    );

    expect(summary.id).toBe("m-42");
    expect(summary.summonerName).toBe("PlayerOne");
    expect(summary.champion).toBe("Ahri");
    expect(summary.kda).toBe("10/2/7");
    expect(summary.gameResult).toBe("Victory");
    expect(summary.gameTime).toBe("02:05");
    expect(summary.cs).toBe(92);
    expect(summary.teamImpact).toBe(4.2);
    expect(summary.yourImpact).toBe(7.3);
    expect(summary.data).toEqual([
      { minute: 5, yourImpact: 1.1, teamImpact: 0.9 },
      { minute: 10, yourImpact: 2.2, teamImpact: 1.3 },
    ]);
  });
});
