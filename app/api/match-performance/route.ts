import { NextRequest, NextResponse } from "next/server";
import {
  getMatchDetails,
  getMatchTimeline,
  getCurrentRankEntries,
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
import { getSql } from "@/lib/neon";
import { checkSyncGate } from "@/lib/sync-gate";
import type { PlayerMatchRow } from "@/lib/database-queries";
import { selectCurrentRankSnapshot } from "@/lib/rank-snapshot";
import { instrumentRoute } from "@/lib/analytics-instrumentation";

const CURRENT_DERIVATION_VERSION = "match-summary-v2";

function serializeOptionalIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function _GET(request: NextRequest) {
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
    let matchDetails = cacheEntry.matchData;
    let matchTimeline = cacheEntry.timelineData;
    let matchDetailsError: unknown;
    let matchTimelineError: unknown;

    // Server-side sync gate: when cache is cold, reject Riot-bound requests
    // during the fresh window to prevent unnecessary API calls.
    if (!matchDetails || !matchTimeline) {
      const syncMetadata = await getPlayerSyncMetadata(userPuuid);
      const gateResult = checkSyncGate(syncMetadata?.last_riot_sync_at ?? null);
      if (gateResult) {
        return NextResponse.json(gateResult, { status: 429 });
      }
    }

    if (!matchDetails || !matchTimeline) {
      const [matchDetailsResult, matchTimelineResult] = await Promise.allSettled([
        getMatchDetails(matchId),
        getMatchTimeline(matchId),
      ]);

      if (matchDetailsResult.status === "fulfilled") {
        matchDetails = matchDetailsResult.value;
      } else {
        matchDetailsError = matchDetailsResult.reason;
      }

      if (matchTimelineResult.status === "fulfilled") {
        matchTimeline = matchTimelineResult.value;
      } else {
        matchTimelineError = matchTimelineResult.reason;
      }
    }

    if (!matchDetails) {
      if (matchDetailsError) {
        console.error("match-details fetch failed:", matchId, matchDetailsError);
      }
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
      if (matchTimelineError) {
        console.error("match-timeline fetch failed:", matchId, matchTimelineError);
      }
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

    const rankLookupId = userParticipant.summonerId?.trim() || userParticipant.puuid;
    const rankSnapshot = rankLookupId
      ? selectCurrentRankSnapshot(await getCurrentRankEntries(rankLookupId))
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
      is_remake: userParticipant.gameEndedInEarlySurrender === true || (!("gameEndedInEarlySurrender" in userParticipant) && matchDetails.info.gameDuration < 300),
    };

    const persistError = await upsertPlayerMatch(row);
    const existingSyncMetadata = await getPlayerSyncMetadata(userPuuid);
    const existingRecentRows = await getPlayerMatchRowsForStaleCheck(userPuuid, [matchId]);
    const existingRow = existingRecentRows[0] ?? null;
    let cacheErrorMessage: string | undefined;
    if (!cacheEntry.matchData || !cacheEntry.timelineData) {
      try {
        const sql = getSql();
        await sql`
          INSERT INTO match_cache (match_id, match_data, timeline_data)
          VALUES (${matchId}, ${JSON.stringify(matchDetails)}::jsonb, ${JSON.stringify(matchTimeline)}::jsonb)
          ON CONFLICT (match_id) DO UPDATE SET
            match_data = EXCLUDED.match_data,
            timeline_data = EXCLUDED.timeline_data
        `;
      } catch (cacheError) {
        cacheErrorMessage = cacheError instanceof Error ? cacheError.message : String(cacheError);
        console.error("match_cache upsert failed:", matchId, cacheError);
      }
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
      last_full_refresh_at: serializeOptionalIso(existingSyncMetadata?.last_full_refresh_at),
      last_riot_sync_at: serializeOptionalIso(existingSyncMetadata?.last_riot_sync_at),
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

/** Neon client factory for analytics instrumentation. */
function analyticsNeonClient() {
  return { sql: getSql() };
}

export const GET = instrumentRoute("/api/match-performance", _GET, analyticsNeonClient);
