// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { MatchSummary } from "./bridge";
import {
  buildHistoryExportFileName,
  createLoadedHistoryExportRows,
  serializeHistoryExportRowsToCsv,
} from "./history-export";

const MATCH_FIXTURES: MatchSummary[] = [
  {
    id: "NA1_1",
    summonerName: "Player One",
    champion: "Ahri",
    rank: null,
    rankLabel: "Rank unavailable",
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
    rankLabel: "Rank unavailable",
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

describe("history-export", () => {
  it("deduplicates mixed loaded history while preserving first-seen order", () => {
    const rows = createLoadedHistoryExportRows([
      MATCH_FIXTURES[0],
      MATCH_FIXTURES[1],
      MATCH_FIXTURES[0],
    ]);

    expect(rows.map((row) => row.matchId)).toEqual(["NA1_1", "NA1_2"]);
  });

  it("maps filtered loaded history into truthful export rows", () => {
    const [row] = createLoadedHistoryExportRows([MATCH_FIXTURES[0]]);

    expect(row).toEqual({
      matchId: "NA1_1",
      summonerName: "Player One",
      champion: "Ahri",
      result: "Victory",
      impactCategory: "Impact win",
      rank: "Rank unavailable",
      kda: "8/2/6",
      cs: 210,
      visionScore: 22,
      playedAt: "1h ago",
      gameTime: "31m",
      duration: "31m 00s",
      role: "Mid",
      damageToChampions: "28,000 damage to champions",
      yourImpact: 32.1,
      teamImpact: 21.4,
    });
  });

  it("serializes rows to csv with escaped labels", () => {
    const csv = serializeHistoryExportRowsToCsv(
      createLoadedHistoryExportRows([MATCH_FIXTURES[0]])
    );

    expect(csv).toContain("matchId,summonerName,champion,result,impactCategory");
    expect(csv).toContain("NA1_1,Player One,Ahri,Victory,Impact win");
    expect(csv).toContain("\"28,000 damage to champions\"");
  });

  it("builds a stable file name for the loaded history scope", () => {
    expect(buildHistoryExportFileName("Validation Fixture", "LOCAL")).toBe(
      "validation-fixture-local-loaded-history.csv"
    );
  });
});
