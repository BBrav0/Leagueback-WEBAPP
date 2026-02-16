import { NextRequest, NextResponse } from "next/server";
import {
  getPaginatedMatchIds,
  getStoredMatchDetails,
  getStoredMatchTimelines,
} from "@/lib/database-queries";
import { reconstructMatchSummary } from "@/lib/match-reconstruction";
import type { MatchSummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  if (!puuid) {
    return NextResponse.json(
      { error: "Missing puuid" },
      { status: 400 }
    );
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  try {
    // Get paginated match IDs and total count from DB only
    const { matchIds, totalCount } = await getPaginatedMatchIds(puuid, limit, offset);

    if (matchIds.length === 0) {
      return NextResponse.json({
        matches: [],
        totalCount,
        hasMore: false,
      });
    }

    // Fetch match details and timelines in parallel
    const [matchDetailsMap, timelineMap] = await Promise.all([
      getStoredMatchDetails(matchIds),
      getStoredMatchTimelines(matchIds),
    ]);

    // Reconstruct MatchSummary objects
    const matches: MatchSummary[] = [];
    for (const matchId of matchIds) {
      const matchDetails = matchDetailsMap.get(matchId);
      const matchTimeline = timelineMap.get(matchId);

      if (matchDetails && matchTimeline) {
        try {
          const summary = reconstructMatchSummary(
            matchId,
            puuid,
            matchDetails,
            matchTimeline
          );
          matches.push(summary);
        } catch (error) {
          console.error(`Error reconstructing match ${matchId}:`, error);
        }
      }
    }

    const hasMore = offset + matchIds.length < totalCount;

    return NextResponse.json({
      matches,
      totalCount,
      hasMore,
    });
  } catch (error) {
    console.error("Error fetching stored matches:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
