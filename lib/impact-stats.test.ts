import { describe, expect, it } from "vitest";
import { classifyMatch, deriveImpactCountsFromMatches } from "./impact-stats";
import type { MatchSummary } from "./types";

function makeMatch(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    id: "1",
    summonerName: "x",
    champion: "Ahri",
    rank: null,
    rankLabel: "Current rank snapshot unavailable",
    rankQueue: null,
    kda: "1/1/1",
    cs: 100,
    visionScore: 10,
    gameResult: "Victory",
    gameTime: "20m",
    playedAt: "Played time unavailable",
    durationSeconds: 1200,
    role: null,
    roleLabel: "Role unavailable",
    damageToChampions: null,
    damageToChampionsLabel: "Damage unavailable",
    impactCategory: "impactWins",
    impactCategoryLabel: "Impact win",
    data: [],
    yourImpact: 5,
    teamImpact: 3,
    ...overrides,
  };
}

describe("classifyMatch", () => {
  it("impact win: victory and higher your impact", () => {
    expect(classifyMatch(makeMatch({ gameResult: "Victory", yourImpact: 10, teamImpact: 5 }))).toBe(
      "impactWins"
    );
  });

  it("impact loss: defeat and not higher your impact", () => {
    expect(classifyMatch(makeMatch({ gameResult: "Defeat", yourImpact: 3, teamImpact: 8 }))).toBe(
      "impactLosses"
    );
  });

  it("guaranteed loss: defeat but higher your impact", () => {
    expect(classifyMatch(makeMatch({ gameResult: "Defeat", yourImpact: 9, teamImpact: 4 }))).toBe(
      "guaranteedLosses"
    );
  });

  it("guaranteed win: victory but not higher your impact", () => {
    expect(classifyMatch(makeMatch({ gameResult: "Victory", yourImpact: 2, teamImpact: 7 }))).toBe(
      "guaranteedWins"
    );
  });

  it("tie impact uses non-higher branch (product rule)", () => {
    expect(classifyMatch(makeMatch({ gameResult: "Victory", yourImpact: 6, teamImpact: 6 }))).toBe(
      "guaranteedWins"
    );
    expect(classifyMatch(makeMatch({ gameResult: "Defeat", yourImpact: 6, teamImpact: 6 }))).toBe(
      "impactLosses"
    );
  });
});

describe("deriveImpactCountsFromMatches", () => {
  it("returns zeros for empty input", () => {
    const { pie, lifetime } = deriveImpactCountsFromMatches([]);
    expect(lifetime).toEqual({
      impactWins: 0,
      impactLosses: 0,
      guaranteedWins: 0,
      guaranteedLosses: 0,
    });
    expect(pie).toEqual(lifetime);
  });

  it("lifetime aggregates all matches; pie uses first 10 only", () => {
    const matches: MatchSummary[] = [];
    for (let i = 0; i < 15; i++) {
      matches.push(
        makeMatch({
          id: String(i),
          gameResult: "Victory",
          yourImpact: 10,
          teamImpact: 5,
        })
      );
    }
    const { pie, lifetime } = deriveImpactCountsFromMatches(matches);
    expect(lifetime.impactWins).toBe(15);
    expect(pie.impactWins).toBe(10);
  });
});
