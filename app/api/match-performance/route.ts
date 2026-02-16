import { NextRequest, NextResponse } from "next/server";
import { getMatchDetails, getMatchTimeline } from "@/lib/riot-api-service";
import { reconstructMatchSummary, determineImpactCategory } from "@/lib/match-reconstruction";
import { supabase } from "@/lib/supabase";

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

    // Reconstruct match summary using shared logic
    const matchSummary = reconstructMatchSummary(
      matchId,
      userPuuid,
      matchDetails,
      matchTimeline
    );

    // Determine impact category and store in Supabase (fire-and-forget)
    const category = determineImpactCategory(
      matchSummary.gameResult,
      matchSummary.yourImpact,
      matchSummary.teamImpact
    );

    supabase
      .from("impact_categories")
      .upsert({ match_id: matchId, puuid: userPuuid, category })
      .then();

    return NextResponse.json({ success: true, matchSummary });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
