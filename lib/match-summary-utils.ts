"use client";

import type { MatchSummary } from "./bridge";

export function formatMatchDurationLabel(durationSeconds: number): string {
  const safeDuration = Math.max(durationSeconds, 0);
  const minutes = Math.floor(safeDuration / 60);
  const seconds = safeDuration % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function mergeMatchesInLoadedOrder(
  existing: MatchSummary[],
  incoming: MatchSummary[]
): MatchSummary[] {
  const merged = [...existing];
  const seen = new Set(existing.map((match) => match.id));

  for (const match of incoming) {
    if (seen.has(match.id)) {
      continue;
    }

    seen.add(match.id);
    merged.push(match);
  }

  return merged;
}
