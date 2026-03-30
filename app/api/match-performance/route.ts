import { NextRequest, NextResponse } from "next/server";
import {
  getMatchDetails,
  getMatchTimeline,
} from "@/lib/riot-api-service";
import {
  reconstructMatchSummary,
  determineImpactCategory,
} from "@/lib/match-reconstruction";
import {
  getMatchCacheEntry,
  getPlayerSyncMetadata,
  upsertPlayerMatch,
  upsertPlayerSyncMetadata,
} from "@/lib/database-queries";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { PlayerMatchRow } from "@/lib/database-queries";

const CURRENT_DERIVATION_VERSION = "match-summary-v2";

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
    const cacheEntry = await getMatchCacheEntry(matchId);
    const [matchDetails, matchTimeline] =
      cacheEntry.matchData && cacheEntry.timelineData
        ? [cacheEntry.matchData, cacheEntry.timelineData]
        : await Promise.all([getMatchDetails(matchId), getMatchTimeline(matchId)]);

    if (!matchDetails) {
      return NextResponse.json({
        success: false,
        error: "Could not retrieve match details.",
      }, { status: 404 });
    }

    const userParticipant = matchDetails.info.participants.find(
      (p) => p.puuid === userPuuid
    );
    if (!userParticipant) {
      return NextResponse.json({
        success: false,
        error: "User not found in match.",
      }, { status: 400 });
    }

    if (!matchTimeline) {
      return NextResponse.json({
        success: false,
        error: "Could not retrieve match timeline data.",
      }, { status: 404 });
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

    const persistError = await upsertPlayerMatch(row);
    const existingSyncMetadata = await getPlayerSyncMetadata(userPuuid);
    let cacheErrorMessage: string | undefined;
    if (!cacheEntry.matchData || !cacheEntry.timelineData) {
      const { error: cacheError } = await getSupabaseServer()
        .from("match_cache")
        .upsert(
          { match_id: matchId, match_data: matchDetails, timeline_data: matchTimeline },
          { onConflict: "match_id" }
        );
      cacheErrorMessage = cacheError?.message;
    }

    const syncMetadataPersistError = await upsertPlayerSyncMetadata({
      puuid: userPuuid,
      latest_db_match_id: matchId,
      latest_db_match_created_at: row.game_creation,
      latest_riot_match_id: existingSyncMetadata?.latest_riot_match_id ?? matchId,
      latest_riot_match_created_at:
        existingSyncMetadata?.latest_riot_match_created_at ?? row.game_creation,
      recent_match_window: existingSyncMetadata?.recent_match_window ?? 25,
      reconciled_through_match_created_at: Math.max(
        row.game_creation,
        existingSyncMetadata?.reconciled_through_match_created_at ?? 0
      ),
      last_known_account_game_name: existingSyncMetadata?.last_known_account_game_name ?? null,
      last_known_account_tag_line: existingSyncMetadata?.last_known_account_tag_line ?? null,
      derivation_version: CURRENT_DERIVATION_VERSION,
      last_stale_derived_refresh_at: new Date().toISOString(),
      last_full_refresh_at: existingSyncMetadata?.last_full_refresh_at ?? null,
      last_riot_sync_at: existingSyncMetadata?.last_riot_sync_at ?? null,
      notes: existingSyncMetadata?.notes ?? {},
    });

    return NextResponse.json({
      success: true,
      matchSummary,
      ...(persistError ? { playerMatchesPersistError: persistError } : {}),
      ...(cacheErrorMessage ? { matchCachePersistError: cacheErrorMessage } : {}),
      ...(syncMetadataPersistError ? { syncMetadataPersistError } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
