import { NextRequest, NextResponse } from "next/server";
import {
  getAllStoredMatchIds,
  getStoredMatchDetails,
  getStoredMatchTimelines,
} from "@/lib/database-queries";
import { reconstructMatchSummary } from "@/lib/match-reconstruction";
import { getMatchHistory } from "@/lib/riot-api-service";
import type { MatchSummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");

  if (!puuid) {
    return NextResponse.json(
      { error: "Missing puuid" },
      { status: 400 }
    );
  }

  try {
    // Get all stored match IDs for this user
    const storedMatchIds = await getAllStoredMatchIds(puuid);

    if (storedMatchIds.length === 0) {
      // Check if there are any matches available from API
      const apiMatchIds = await getMatchHistory(puuid, 1, 0);
      const hasMoreInApi = apiMatchIds.length > 0;

      return NextResponse.json({
        matches: [],
        storedCount: 0,
        hasMoreInApi,
      });
    }

    // Fetch match details and timelines in parallel
    const [matchDetailsMap, timelineMap] = await Promise.all([
      getStoredMatchDetails(storedMatchIds),
      getStoredMatchTimelines(storedMatchIds),
    ]);

    // Reconstruct MatchSummary objects
    const matches: MatchSummary[] = [];
    for (const matchId of storedMatchIds) {
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
          // Skip this match but continue with others
        }
      }
    }

    // Check if there are more matches available from API
    // Get a batch from API that's larger than stored matches to check for new ones
    const checkSize = Math.max(storedMatchIds.length + 5, 20); // Check at least 20 matches
    const apiMatchIds = await getMatchHistory(puuid, checkSize, 0);
    const storedMatchIdsSet = new Set(storedMatchIds);
    
    // Check if API has any matches not in our stored set
    // Also check if API returned the full requested amount (indicating more might exist)
    const hasNewMatches = apiMatchIds.some((id) => !storedMatchIdsSet.has(id));
    const apiHasMore = apiMatchIds.length >= checkSize;
    const hasMoreInApi = hasNewMatches || apiHasMore;

    return NextResponse.json({
      matches,
      storedCount: storedMatchIds.length,
      hasMoreInApi,
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
