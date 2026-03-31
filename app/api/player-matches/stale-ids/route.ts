import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getPlayerMatchRowsForStaleCheck, type PlayerSyncMetadataRow } from "@/lib/database-queries";

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

export async function POST(request: NextRequest) {
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

    const supabase = getSupabaseServer();
    const [{ data: syncMetadata, error: syncError }] =
      await Promise.all([
        supabase
          .from("player_sync_metadata")
          .select("derivation_version, recent_match_window, notes")
          .eq("puuid", puuid)
          .maybeSingle(),
      ]);

    if (syncError) {
      console.error("Error fetching player sync metadata for stale detection:", syncError);
    }

    const playerRows = await getPlayerMatchRowsForStaleCheck(puuid, matchIds);
    const rowByMatchId = new Map(
      playerRows.map((row) => [row.match_id, row])
    );
    const perMatchDerivationVersions = readPerMatchRecord(syncMetadata?.notes, "perMatchDerivationVersions");
    const perMatchUpdatedAt = readPerMatchRecord(syncMetadata?.notes, "perMatchUpdatedAt");

    const { data: cacheRows, error: cacheRowsError } = await supabase
      .from("match_cache")
      .select("match_id, match_data")
      .in("match_id", matchIds);

    if (cacheRowsError) {
      console.error("Error fetching match cache rows for stale detection:", cacheRowsError);
    }

    const cacheInfoByMatchId = new Map(
      ((cacheRows as Array<{
        match_id: string;
        match_data?: { info?: { gameCreation?: number; gameDuration?: number } } | null;
      }> | null) ?? []).map((row) => [
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
