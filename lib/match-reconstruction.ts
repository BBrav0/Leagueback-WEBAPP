import { generateChartData } from "./performance-calculation";
import type { MatchDto, MatchTimelineDto, MatchSummary, Participant } from "./types";

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

  return {
    id: matchId,
    summonerName: userParticipant.summonerName,
    champion: userParticipant.championName,
    rank: "Feature coming soon \u{1F440}",
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
