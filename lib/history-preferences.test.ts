// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MatchSummary } from "./bridge";
import {
  countActiveHistoryFilters,
  DEFAULT_HISTORY_PREFERENCES,
  filterAndSortMatches,
  loadHistoryPreferences,
  resetHistoryPreferences,
  saveHistoryPreferences,
} from "./history-preferences";

const MATCH_FIXTURES: MatchSummary[] = [
  {
    id: "1",
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
    yourImpact: 32.1,
    teamImpact: 21.4,
  },
  {
    id: "2",
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
    yourImpact: 14.2,
    teamImpact: 18.1,
  },
  {
    id: "3",
    summonerName: "Player One",
    champion: "Aatrox",
    rank: null,
    rankLabel: "Rank unavailable",
    kda: "10/3/5",
    cs: 198,
    visionScore: 12,
    gameResult: "Victory",
    gameTime: "28m",
    playedAt: "5h ago",
    durationSeconds: 1680,
    role: "TOP",
    roleLabel: "Top",
    damageToChampions: 31000,
    damageToChampionsLabel: "31,000 damage to champions",
    impactCategory: "guaranteedWins",
    impactCategoryLabel: "Guaranteed win",
    data: [],
    yourImpact: 25.4,
    teamImpact: 20.2,
  },
];

describe("history-preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("loads defaults when storage is empty or corrupted", () => {
    expect(loadHistoryPreferences()).toEqual(DEFAULT_HISTORY_PREFERENCES);

    localStorage.setItem("leagueback_history_preferences", "{bad json");

    expect(loadHistoryPreferences()).toEqual(DEFAULT_HISTORY_PREFERENCES);
  });

  it("persists sanitized history preferences and can reset them", () => {
    const saved = saveHistoryPreferences({
      result: "Victory",
      impactCategory: "impactWins",
      champion: "  ahri ",
      sort: "highestImpact",
      compactCards: true,
    });

    expect(saved).toEqual({
      result: "Victory",
      impactCategory: "impactWins",
      champion: "ahri",
      sort: "highestImpact",
      compactCards: true,
    });
    expect(loadHistoryPreferences()).toEqual(saved);
    expect(resetHistoryPreferences()).toEqual(DEFAULT_HISTORY_PREFERENCES);
    expect(loadHistoryPreferences()).toEqual(DEFAULT_HISTORY_PREFERENCES);
  });

  it("filters loaded matches by result, impact category, and champion", () => {
    const filtered = filterAndSortMatches(MATCH_FIXTURES, {
      ...DEFAULT_HISTORY_PREFERENCES,
      result: "Victory",
      impactCategory: "impactWins",
      champion: "ah",
    });

    expect(filtered.map((match) => match.id)).toEqual(["1"]);
  });

  it("supports highest impact sorting while preserving default order otherwise", () => {
    expect(
      filterAndSortMatches(MATCH_FIXTURES, DEFAULT_HISTORY_PREFERENCES).map((match) => match.id)
    ).toEqual(["1", "2", "3"]);

    expect(
      filterAndSortMatches(MATCH_FIXTURES, {
        ...DEFAULT_HISTORY_PREFERENCES,
        sort: "highestImpact",
      }).map((match) => match.id)
    ).toEqual(["1", "3", "2"]);
  });

  it("counts only non-default filters as active", () => {
    expect(countActiveHistoryFilters(DEFAULT_HISTORY_PREFERENCES)).toBe(0);
    expect(
      countActiveHistoryFilters({
        ...DEFAULT_HISTORY_PREFERENCES,
        result: "Defeat",
        champion: "Jinx",
      })
    ).toBe(2);
  });
});
