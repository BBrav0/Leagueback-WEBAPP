import { NextRequest, NextResponse } from "next/server";
import { getMatchDetails, getMatchTimeline } from "@/lib/riot-api-service";
import { generateChartData } from "@/lib/performance-calculation";
import { supabase } from "@/lib/supabase";
import type { MatchTimelineDto, Participant } from "@/lib/types";

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  const userPuuid = searchParams.get("userPuuid");

  if (!matchId || !userPuuid) {
    return NextResponse.json(
      { success: false, error: "Missing matchId or userPuuid" },
      { status: 400 }
    );
  }

  try {
    const [matchDetails, matchTimeline] = await Promise.all([
      getMatchDetails(matchId),
      getMatchTimeline(matchId),
    ]);

    if (!matchDetails) {
      return NextResponse.json({
        success: false,
        error: "Could not retrieve match details.",
      });
    }

    const userParticipant = matchDetails.info.participants.find(
      (p) => p.puuid === userPuuid
    );
    if (!userParticipant) {
      return NextResponse.json({
        success: false,
        error: "User not found in match.",
      });
    }

    if (!matchTimeline) {
      return NextResponse.json({
        success: false,
        error: "Could not retrieve match timeline data.",
      });
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

    // Determine impact category
    const youHigher = yourImpactAvg > teamImpactAvg;
    let category: string;
    if (gameResult === "Victory" && youHigher) category = "impactWins";
    else if (gameResult === "Defeat" && !youHigher) category = "impactLosses";
    else if (gameResult === "Victory") category = "guaranteedWins";
    else category = "guaranteedLosses";

    // Store in Supabase (fire-and-forget)
    supabase
      .from("impact_categories")
      .upsert({ match_id: matchId, puuid: userPuuid, category })
      .then();

    // Remove minute -1 from chart data sent to frontend
    const chartData = performanceData.filter((p) => p.minute !== -1);

    const kda = `${userParticipant.kills}/${userParticipant.deaths}/${userParticipant.assists}`;

    const matchSummary = {
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

    return NextResponse.json({ success: true, matchSummary });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
