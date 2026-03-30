import { NextRequest, NextResponse } from "next/server";
import {
  getMatchDetails,
  getMatchTimeline,
  getCurrentRankEntries,
  getSummonerIdByPuuid,
} from "@/lib/riot-api-service";
import {
  reconstructMatchSummary,
  determineImpactCategory,
} from "@/lib/match-reconstruction";
import {
  getMatchCacheEntry,
  getPlayerSyncMetadata,
  getPlayerMatchRowsForStaleCheck,
  upsertPlayerMatch,
  upsertPlayerSyncMetadata,
} from "@/lib/database-queries";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { PlayerMatchRow } from "@/lib/database-queries";
import { selectCurrentRankSnapshot } from "@/lib/rank-snapshot";

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

    const summonerId = await getSummonerIdByPuuid(userParticipant.puuid);
    const rankSnapshot = summonerId
      ? selectCurrentRankSnapshot(await getCurrentRankEntries(summonerId))
      : null;

    if (rankSnapshot) {
      matchSummary.rank = rankSnapshot.rank;
      matchSummary.rankLabel = rankSnapshot.rankLabel;
      matchSummary.rankQueue = rankSnapshot.rankQueue;
    }

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
      rank: matchSummary.rank,
      rank_queue: matchSummary.rankQueue,
      role: matchSummary.role,
      damage_to_champions: matchSummary.damageToChampions,
    };

    const persistError = await upsertPlayerMatch(row);
    const existingSyncMetadata = await getPlayerSyncMetadata(userPuuid);
    const existingRecentRows = await getPlayerMatchRowsForStaleCheck(userPuuid, [matchId]);
    const existingRow = existingRecentRows[0] ?? null;
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

    const latestDbCreatedAt = existingSyncMetadata?.latest_db_match_created_at ?? null;
    const latestRiotCreatedAt = existingSyncMetadata?.latest_riot_match_created_at ?? null;
    const nextLatestDbCreatedAt =
      latestDbCreatedAt === null || row.game_creation >= latestDbCreatedAt
        ? row.game_creation
        : latestDbCreatedAt;
    const nextLatestDbMatchId =
      latestDbCreatedAt === null || row.game_creation >= latestDbCreatedAt
        ? matchId
        : existingSyncMetadata?.latest_db_match_id ?? matchId;
    const nextLatestRiotCreatedAt =
      latestRiotCreatedAt === null || row.game_creation >= latestRiotCreatedAt
        ? row.game_creation
        : latestRiotCreatedAt;
    const nextLatestRiotMatchId =
      latestRiotCreatedAt === null || row.game_creation >= latestRiotCreatedAt
        ? matchId
        : existingSyncMetadata?.latest_riot_match_id ?? matchId;
    const matchFreshness = {
      ...(existingSyncMetadata?.notes ?? {}),
      perMatchDerivationVersions: {
        ...((existingSyncMetadata?.notes?.perMatchDerivationVersions as Record<string, string> | undefined) ?? {}),
        [matchId]: CURRENT_DERIVATION_VERSION,
      },
      perMatchUpdatedAt: {
        ...((existingSyncMetadata?.notes?.perMatchUpdatedAt as Record<string, string> | undefined) ?? {}),
        [matchId]: new Date().toISOString(),
      },
      perMatchPreviousUpdatedAt: {
        ...((existingSyncMetadata?.notes?.perMatchPreviousUpdatedAt as Record<string, string> | undefined) ?? {}),
        ...(existingRow?.created_at ? { [matchId]: existingRow.created_at } : {}),
      },
    };

    const syncMetadataPersistError = await upsertPlayerSyncMetadata({
      puuid: userPuuid,
      latest_db_match_id: nextLatestDbMatchId,
      latest_db_match_created_at: nextLatestDbCreatedAt,
      latest_riot_match_id: nextLatestRiotMatchId,
      latest_riot_match_created_at: nextLatestRiotCreatedAt,
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
      notes: matchFreshness,
    });

    return NextResponse.json({
      success: true,
      matchSummary,
      syncMetadata: {
        recentMatchWindow: existingSyncMetadata?.recent_match_window ?? 25,
      },
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
