import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

const MAX_IDS = 100;
const MATCH_ID_PATTERN = /^[A-Z0-9_]+$/i;

function isValidMatchId(matchId: string): boolean {
  return MATCH_ID_PATTERN.test(matchId);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const puuid = typeof body?.puuid === "string" ? body.puuid : undefined;
    const matchIdsRaw = body?.matchIds;

    if (!puuid) {
      return NextResponse.json({ error: "Missing puuid" }, { status: 400 });
    }
    if (!Array.isArray(matchIdsRaw) || matchIdsRaw.length === 0) {
      return NextResponse.json({ error: "Missing matchIds" }, { status: 400 });
    }

    const matchIds = matchIdsRaw
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && isValidMatchId(id))
      .slice(0, MAX_IDS);

    if (matchIds.length === 0) {
      return NextResponse.json({ existingMatchIds: [] });
    }

    const { data, error } = await getSupabaseServer()
      .from("player_matches")
      .select("match_id")
      .eq("puuid", puuid)
      .in("match_id", matchIds);

    if (error) {
      console.error("existing-ids query failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const existing = (data ?? []).map((r) => r.match_id as string);

    return NextResponse.json({
      existingMatchIds: existing,
    });
  } catch (e) {
    console.error("existing-ids route error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid request body" },
      { status: 400 }
    );
  }
}
