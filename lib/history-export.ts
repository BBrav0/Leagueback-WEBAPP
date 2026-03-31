"use client";

import type { MatchSummary } from "./bridge";
import { formatMatchDurationLabel, mergeMatchesInLoadedOrder } from "./match-summary-utils";

export interface ExportableHistoryRow {
  matchId: string;
  summonerName: string;
  champion: string;
  result: MatchSummary["gameResult"];
  impactCategory: MatchSummary["impactCategoryLabel"];
  rank: string;
  kda: string;
  cs: number;
  visionScore: number;
  playedAt: string;
  gameTime: string;
  duration: string;
  role: string;
  damageToChampions: string;
  yourImpact: number;
  teamImpact: number;
}

export function createLoadedHistoryExportRows(
  matches: MatchSummary[],
): ExportableHistoryRow[] {
  return mergeMatchesInLoadedOrder([], matches).map((match) => ({
    matchId: match.id,
    summonerName: match.summonerName,
    champion: match.champion,
    result: match.gameResult,
    impactCategory: match.impactCategoryLabel,
    rank: match.rankLabel,
    kda: match.kda,
    cs: match.cs,
    visionScore: match.visionScore,
    playedAt: match.playedAt,
    gameTime: match.gameTime,
    duration: formatMatchDurationLabel(match.durationSeconds),
    role: match.roleLabel,
    damageToChampions: match.damageToChampionsLabel,
    yourImpact: Number(match.yourImpact.toFixed(1)),
    teamImpact: Number(match.teamImpact.toFixed(1)),
  }));
}

function escapeCsvValue(value: string | number): string {
  const normalized = String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }

  return normalized;
}

export function serializeHistoryExportRowsToCsv(rows: ExportableHistoryRow[]): string {
  const headers: Array<keyof ExportableHistoryRow> = [
    "matchId",
    "summonerName",
    "champion",
    "result",
    "impactCategory",
    "rank",
    "kda",
    "cs",
    "visionScore",
    "playedAt",
    "gameTime",
    "duration",
    "role",
    "damageToChampions",
    "yourImpact",
    "teamImpact",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
  ];

  return lines.join("\n");
}

export function buildHistoryExportFileName(gameName: string, tagLine: string): string {
  const slug = `${gameName}-${tagLine}`
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "leagueback-history"}-loaded-history.csv`;
}
