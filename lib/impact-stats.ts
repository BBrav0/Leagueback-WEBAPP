import type { ImpactCategory, MatchSummary } from "./types";

export type ImpactCounts = Record<ImpactCategory, number>;

export function classifyMatch(match: MatchSummary): ImpactCategory {
  const youHigher = match.yourImpact > match.teamImpact;
  const win = match.gameResult === "Victory";

  if (win && youHigher) return "impactWins";
  if (!win && !youHigher) return "impactLosses";
  if (!win && youHigher) return "guaranteedLosses";
  return "guaranteedWins";
}

export function deriveImpactCountsFromMatches(matches: MatchSummary[]): {
  pie: ImpactCounts;
  lifetime: ImpactCounts;
} {
  const lifetime: ImpactCounts = {
    impactWins: 0,
    impactLosses: 0,
    guaranteedWins: 0,
    guaranteedLosses: 0,
  };
  for (const m of matches) {
    lifetime[classifyMatch(m)]++;
  }
  const pie: ImpactCounts = {
    impactWins: 0,
    impactLosses: 0,
    guaranteedWins: 0,
    guaranteedLosses: 0,
  };
  for (const m of matches.slice(0, 10)) {
    pie[classifyMatch(m)]++;
  }
  return { pie, lifetime };
}
