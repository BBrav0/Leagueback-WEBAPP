import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/neon";
import { getPlayerMatchRowsForStaleCheck, type PlayerSyncMetadataRow } from "@/lib/database-queries";
import { instrumentRoute } from "@/lib/analytics-instrumentation";

const CURRENT_DERIVATION_VERSION = "match-summary-v2";

function isValidMatchId(matchId: string): boolean {
  return /^[A-Z0-9_]+$/i.test(matchId);
}

function readPerMatchRecord(
  notes: PlayerSyncMetadataRow["notes"],
  key: string
): Record<string, string> {
  const value = notes?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

async function _POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      puuid?: string;
      matchIds?: string[];
      derivationVersion?: string;
    };

    const puuid = body.puuid?.trim();
    const derivationVersion = body.derivationVersion?.trim() || CURRENT_DERIVATION_VERSION;
    const matchIds = (body.matchIds ?? [])
      .filter((matchId): matchId is string => typeof matchId === "string")
      .map((matchId) => matchId.trim())
      .filter((matchId) => matchId.length > 0 && isValidMatchId(matchId));

    if (!puuid || matchIds.length === 0) {
      return NextResponse.json(
        { error: "Missing puuid or valid matchIds" },
        { status: 400 }
      );
    }

    const sql = getSql();

    // Fetch sync metadata
    let syncMetadata: {
      derivation_version: string | null;
      recent_match_window: number | null;
      notes: Record<string, unknown> | null;
    } | null = null;
    try {
      const syncRows = await sql`
        SELECT derivation_version, recent_match_window, notes
        FROM player_sync_metadata
        WHERE puuid = ${puuid}
      ` as Array<{
        derivation_version: string | null;
        recent_match_window: number | null;
        notes: Record<string, unknown> | null;
      }>;
      syncMetadata = syncRows[0] ?? null;
    } catch (syncError) {
      console.error("Error fetching player sync metadata for stale detection:", syncError);
    }

    const playerRows = await getPlayerMatchRowsForStaleCheck(puuid, matchIds);
    const rowByMatchId = new Map(
      playerRows.map((row) => [row.match_id, row])
    );
    const perMatchDerivationVersions = readPerMatchRecord(syncMetadata?.notes ?? undefined, "perMatchDerivationVersions");
    const perMatchUpdatedAt = readPerMatchRecord(syncMetadata?.notes ?? undefined, "perMatchUpdatedAt");

    // Fetch match cache rows
    let cacheRows: Array<{
      match_id: string;
      match_data: { info?: { gameCreation?: number; gameDuration?: number } } | null;
    }> = [];
    try {
      cacheRows = await sql`
        SELECT match_id, match_data FROM match_cache
        WHERE match_id = ANY(${matchIds})
      ` as Array<{
        match_id: string;
        match_data: { info?: { gameCreation?: number; gameDuration?: number } } | null;
      }>;
    } catch (cacheError) {
      console.error("Error fetching match cache rows for stale detection:", cacheError);
    }

    const cacheInfoByMatchId = new Map(
      cacheRows.map((row) => [
        row.match_id,
        row.match_data?.info ?? null,
      ])
    );

    const staleMatchIds: string[] = [];

    for (const matchId of matchIds) {
      const row = rowByMatchId.get(matchId);
      if (!row) {
        continue;
      }

      const cacheInfo = cacheInfoByMatchId.get(matchId) ?? null;
      const cacheGameCreation = cacheInfo?.gameCreation ?? null;
      const cacheGameDuration = cacheInfo?.gameDuration ?? null;

      if (
        cacheGameCreation !== null &&
        cacheGameDuration !== null &&
        (row.game_creation !== cacheGameCreation || row.game_duration !== cacheGameDuration)
      ) {
        staleMatchIds.push(matchId);
        continue;
      }

      if ((perMatchDerivationVersions[matchId] ?? syncMetadata?.derivation_version ?? null) !== derivationVersion) {
        staleMatchIds.push(matchId);
        continue;
      }

      if (row.created_at && perMatchUpdatedAt[matchId] && row.created_at !== perMatchUpdatedAt[matchId]) {
        staleMatchIds.push(matchId);
      }
    }

    return NextResponse.json({ staleMatchIds });
  } catch (error) {
    console.error("Error in POST /api/player-matches/stale-ids:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/** Neon client factory for analytics instrumentation. */
function analyticsNeonClient() {
  return { sql: getSql() };
}

export const POST = instrumentRoute("/api/player-matches/stale-ids", _POST, analyticsNeonClient);
