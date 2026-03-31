import { describe, expect, it } from "vitest";

import type { MatchSummary } from "./bridge";
import {
  formatMatchDurationLabel,
  mergeMatchesInLoadedOrder,
} from "./match-summary-utils";

const MATCH_FIXTURES: MatchSummary[] = [
  {
    id: "NA1_1",
    summonerName: "Player One",
    champion: "Ahri",
    rank: null,
    rankLabel: "Current rank snapshot unavailable",
    rankQueue: null,
    kda: "8/2/6",
    cs: 210,
    visionScore: 22,
    gameResult: "Victory",
    gameTime: "31m",
    playedAt: "1h ago",
    durationSeconds: 1860,
    role: "MIDDLE",
    roleLabel: "Mid",
    damageToChampions: 28000,
    damageToChampionsLabel: "28,000 damage to champions",
    impactCategory: "impactWins",
    impactCategoryLabel: "Impact win",
    data: [],
    yourImpact: 32.14,
    teamImpact: 21.44,
  },
  {
    id: "NA1_2",
    summonerName: "Player One",
    champion: "Jinx",
    rank: null,
    rankLabel: "Current rank snapshot unavailable",
    rankQueue: null,
    kda: "4/6/8",
    cs: 240,
    visionScore: 15,
    gameResult: "Defeat",
    gameTime: "34m",
    playedAt: "3h ago",
    durationSeconds: 2040,
    role: "BOTTOM",
    roleLabel: "Bot",
    damageToChampions: 19500,
    damageToChampionsLabel: "19,500 damage to champions",
    impactCategory: "impactLosses",
    impactCategoryLabel: "Impact loss",
    data: [],
    yourImpact: 14.24,
    teamImpact: 18.11,
  },
];

describe("match-summary-utils", () => {
  it("formats match durations consistently for dashboard and export surfaces", () => {
    expect(formatMatchDurationLabel(1860)).toBe("31m 00s");
    expect(formatMatchDurationLabel(-5)).toBe("0m 00s");
  });

  it("merges incoming matches without duplicates while preserving loaded order", () => {
    expect(
      mergeMatchesInLoadedOrder([MATCH_FIXTURES[0]], [MATCH_FIXTURES[1], MATCH_FIXTURES[0]]).map(
        (match) => match.id
      )
    ).toEqual(["NA1_1", "NA1_2"]);
  });
});
