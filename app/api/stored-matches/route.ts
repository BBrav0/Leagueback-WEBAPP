import { NextRequest, NextResponse } from "next/server";
import {
  getPaginatedMatchIds,
  getStoredMatchDetails,
  getStoredMatchTimelines,
} from "@/lib/database-queries";
import {
  reconstructMatchSummary,
  determineImpactCategory,
} from "@/lib/match-reconstruction";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { ImpactCategory, MatchSummary } from "@/lib/types";

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

    // Reconstruct MatchSummary objects and batch-persist impact categories (one round-trip)
    const matches: MatchSummary[] = [];
    const categoryRows: {
      match_id: string;
      puuid: string;
      category: ImpactCategory;
    }[] = [];

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

          const category = determineImpactCategory(
            summary.gameResult,
            summary.yourImpact,
            summary.teamImpact
          );
          categoryRows.push({ match_id: matchId, puuid, category });
        } catch (error) {
          console.error(`Error reconstructing match ${matchId}:`, error);
        }
      }
    }

    if (categoryRows.length > 0) {
      const { error: upsertError } = await getSupabaseServer()
        .from("impact_categories")
        .upsert(categoryRows, { onConflict: "match_id,puuid" });
      if (upsertError) {
        console.error("impact_categories batch upsert failed:", upsertError);
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
