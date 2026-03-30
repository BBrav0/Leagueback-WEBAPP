import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

const CURRENT_DERIVATION_VERSION = "match-summary-v2";

function isValidMatchId(matchId: string): boolean {
  return /^[A-Z0-9_]+$/i.test(matchId);
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
    const [{ data: playerRows, error: playerRowsError }, { data: syncMetadata, error: syncError }] =
      await Promise.all([
        supabase
          .from("player_matches")
          .select("match_id, game_creation, game_duration")
          .eq("puuid", puuid)
          .in("match_id", matchIds),
        supabase
          .from("player_sync_metadata")
          .select("derivation_version, recent_match_window")
          .eq("puuid", puuid)
          .maybeSingle(),
      ]);

    if (playerRowsError) {
      console.error("Error fetching player rows for stale detection:", playerRowsError);
      return NextResponse.json(
        { error: "Failed to inspect player match freshness." },
        { status: 500 }
      );
    }

    if (syncError) {
      console.error("Error fetching player sync metadata for stale detection:", syncError);
    }

    const rowByMatchId = new Map(
      (playerRows ?? []).map((row) => [row.match_id as string, row as { match_id: string; game_creation: number; game_duration: number }])
    );

    const staleMatchIds: string[] = [];

    for (const matchId of matchIds) {
      const row = rowByMatchId.get(matchId);
      if (!row) {
        continue;
      }

      const { data: cacheRow, error: cacheError } = await supabase
        .from("match_cache")
        .select("match_data")
        .eq("match_id", matchId)
        .maybeSingle();

      if (cacheError) {
        console.error("Error fetching match cache for stale detection:", cacheError);
        continue;
      }

      const cacheInfo = (cacheRow?.match_data as { info?: { gameCreation?: number; gameDuration?: number } } | null)?.info;
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

      if ((syncMetadata?.derivation_version ?? null) !== derivationVersion) {
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
