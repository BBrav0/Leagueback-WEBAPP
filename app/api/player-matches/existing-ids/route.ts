import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/neon";
import { instrumentRoute } from "@/lib/analytics-instrumentation";

const MAX_IDS = 100;
const MATCH_ID_PATTERN = /^[A-Z0-9_]+$/i;

function isValidMatchId(matchId: string): boolean {
  return MATCH_ID_PATTERN.test(matchId);
}

async function _POST(request: NextRequest) {
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

    try {
      const sql = getSql();
      const rows = await sql`
        SELECT match_id FROM player_matches
        WHERE puuid = ${puuid} AND match_id = ANY(${matchIds})
      ` as Array<{ match_id: string }>;

      const existing = rows.map((r) => r.match_id);

      return NextResponse.json({
        existingMatchIds: existing,
      });
    } catch (dbError) {
      console.error("existing-ids query failed:", dbError);
      return NextResponse.json(
        { error: dbError instanceof Error ? dbError.message : "Database query failed" },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("existing-ids route error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid request body" },
      { status: 400 }
    );
  }
}

/** Neon client factory for analytics instrumentation. */
function analyticsNeonClient() {
  return { sql: getSql() };
}

export const POST = instrumentRoute("/api/player-matches/existing-ids", _POST, analyticsNeonClient);
