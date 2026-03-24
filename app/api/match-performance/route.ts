import { NextRequest, NextResponse } from "next/server";
import { getMatchDetails, getMatchTimeline } from "@/lib/riot-api-service";
import {
  reconstructMatchSummary,
  determineImpactCategory,
} from "@/lib/match-reconstruction";
import { upsertPlayerMatch } from "@/lib/database-queries";
import type { PlayerMatchRow } from "@/lib/database-queries";

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

    const matchSummary = reconstructMatchSummary(
      matchId,
      userPuuid,
      matchDetails,
      matchTimeline
    );

    const category = determineImpactCategory(
      matchSummary.gameResult,
      matchSummary.yourImpact,
      matchSummary.teamImpact
    );

    const row: PlayerMatchRow = {
      match_id: matchId,
      puuid: userPuuid,
      summoner_name: matchSummary.summonerName,
      champion: matchSummary.champion,
      kda: matchSummary.kda,
      cs: matchSummary.cs,
      vision_score: matchSummary.visionScore,
      game_result: matchSummary.gameResult,
      game_time: matchSummary.gameTime,
      your_impact: matchSummary.yourImpact,
      team_impact: matchSummary.teamImpact,
      impact_category: category,
      chart_data: matchSummary.data,
      game_creation: matchDetails.info.gameCreation ?? 0,
      game_duration: matchDetails.info.gameDuration,
    };

    await upsertPlayerMatch(row);

    return NextResponse.json({ success: true, matchSummary });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
