import { generateChartData } from "./performance-calculation";
import type {
  ImpactCategory,
  MatchDto,
  MatchTimelineDto,
  MatchSummary,
  Participant,
} from "./types";

function getCreepScore(
  participant: Participant,
  timeline: MatchTimelineDto
): number {
  const lastFrame =
    timeline.info.frames[timeline.info.frames.length - 1];
  const frame =
    lastFrame?.participantFrames[participant.participantId.toString()];
  return (frame?.minionsKilled ?? 0) + (frame?.jungleMinionsKilled ?? 0);
}

function formatPlayedAt(gameCreation: number | undefined): string {
  if (!gameCreation || gameCreation <= 0) {
    return "Played time unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(gameCreation));
}

function formatRole(teamPosition: string | undefined): string {
  const normalized = teamPosition?.trim().toUpperCase();
  if (!normalized || normalized === "INVALID") {
    return "Role unavailable";
  }

  const labels: Record<string, string> = {
    TOP: "Top",
    JUNGLE: "Jungle",
    MIDDLE: "Mid",
    BOTTOM: "Bottom",
    UTILITY: "Support",
  };

  return labels[normalized] ?? normalized.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDamageToChampions(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return "Damage unavailable";
  }

  return `${value.toLocaleString()} damage to champions`;
}

function formatImpactCategory(category: ImpactCategory): string {
  const labels: Record<ImpactCategory, string> = {
    impactWins: "Impact win",
    impactLosses: "Impact loss",
    guaranteedWins: "Guaranteed win",
    guaranteedLosses: "Guaranteed loss",
  };

  return labels[category];
}

/**
 * Reconstructs a MatchSummary from match details and timeline data
 * This is the shared logic used by both the API route and database queries
 */
export function reconstructMatchSummary(
  matchId: string,
  userPuuid: string,
  matchDetails: MatchDto,
  matchTimeline: MatchTimelineDto
): MatchSummary {
  const userParticipant = matchDetails.info.participants.find(
    (p) => p.puuid === userPuuid
  );

  if (!userParticipant) {
    throw new Error("User not found in match");
  }

  // Determine game result
  const userTeam = matchDetails.info.teams.find(
    (t) => t.teamId === userParticipant.teamId
  );
  const gameResult = userTeam?.win ? "Victory" : "Defeat";

  // Format game time
  const duration = matchDetails.info.gameDuration;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const gameTime = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // Run performance calculation
  const performanceData = generateChartData(
    matchDetails,
    matchTimeline,
    userPuuid
  );

  // Extract minute -1 averages
  const impacts = performanceData.find((p) => p.minute === -1);
  const teamImpactAvg = impacts?.teamImpact ?? 0;
  const yourImpactAvg = impacts?.yourImpact ?? 0;

  // Remove minute -1 from chart data sent to frontend
  const chartData = performanceData.filter((p) => p.minute !== -1);

  const kda = `${userParticipant.kills}/${userParticipant.deaths}/${userParticipant.assists}`;
  const impactCategory = determineImpactCategory(
    gameResult,
    yourImpactAvg,
    teamImpactAvg
  );

  return {
    id: matchId,
    summonerName: userParticipant.summonerName,
    champion: userParticipant.championName,
    ...buildMatchMetadata({
      gameCreation: matchDetails.info.gameCreation,
      gameDuration: duration,
      teamPosition: userParticipant.teamPosition,
      totalDamageDealtToChampions: userParticipant.totalDamageDealtToChampions,
      impactCategory,
    }),
    kda,
    cs: getCreepScore(userParticipant, matchTimeline),
    visionScore: userParticipant.visionScore,
    gameResult,
    gameTime,
    data: chartData,
    teamImpact: teamImpactAvg,
    yourImpact: yourImpactAvg,
  };
}

/**
 * Determines the impact category for a match
 */
export function determineImpactCategory(
  gameResult: "Victory" | "Defeat",
  yourImpact: number,
  teamImpact: number
): "impactWins" | "impactLosses" | "guaranteedWins" | "guaranteedLosses" {
  const youHigher = yourImpact > teamImpact;
  
  if (gameResult === "Victory" && youHigher) return "impactWins";
  if (gameResult === "Defeat" && !youHigher) return "impactLosses";
  if (gameResult === "Victory") return "guaranteedWins";
  return "guaranteedLosses";
}

export function buildMatchMetadata(options: {
  gameCreation?: number;
  gameDuration: number;
  teamPosition?: string;
  totalDamageDealtToChampions?: number;
  impactCategory: ImpactCategory;
  rank?: string | null;
  rankLabel?: string;
  rankQueue?: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR" | null;
}): Pick<
  MatchSummary,
  | "rank"
  | "rankLabel"
  | "rankQueue"
  | "playedAt"
  | "durationSeconds"
  | "role"
  | "roleLabel"
  | "damageToChampions"
  | "damageToChampionsLabel"
  | "impactCategory"
  | "impactCategoryLabel"
> {
  const role =
    options.teamPosition?.trim() && options.teamPosition.trim().toUpperCase() !== "INVALID"
      ? options.teamPosition.trim().toUpperCase()
      : null;
  const damageToChampions =
    typeof options.totalDamageDealtToChampions === "number" &&
    !Number.isNaN(options.totalDamageDealtToChampions) &&
    options.totalDamageDealtToChampions >= 0
      ? options.totalDamageDealtToChampions
      : null;

  return {
    rank: options.rank ?? null,
    rankLabel: options.rankLabel ?? "Current rank snapshot unavailable",
    rankQueue: options.rankQueue ?? null,
    playedAt: formatPlayedAt(options.gameCreation),
    durationSeconds: options.gameDuration,
    role,
    roleLabel: formatRole(options.teamPosition),
    damageToChampions,
    damageToChampionsLabel: formatDamageToChampions(options.totalDamageDealtToChampions),
    impactCategory: options.impactCategory,
    impactCategoryLabel: formatImpactCategory(options.impactCategory),
  };
}
