import { NextRequest, NextResponse } from "next/server";
import { getMatchHistory } from "@/lib/riot-api-service";
import {
  getValidationFixtureMatchHistory,
  VALIDATION_FIXTURE_ACCOUNT,
} from "@/lib/validation-fixture";
import { getPlayerSyncMetadata } from "@/lib/database-queries";
import { checkSyncGate } from "@/lib/sync-gate";
import { instrumentRoute } from "@/lib/analytics-instrumentation";
import { getSql } from "@/lib/neon";

async function _GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const count = parseInt(searchParams.get("count") ?? "10", 10);
  const start = parseInt(searchParams.get("start") ?? "0", 10);

  if (!puuid) {
    return NextResponse.json({ error: "Missing puuid" }, { status: 400 });
  }

  try {
    // Validation fixture bypasses sync gate entirely.
    if (puuid === VALIDATION_FIXTURE_ACCOUNT.puuid) {
      return NextResponse.json(getValidationFixtureMatchHistory(count, start));
    }

    // Server-side sync gate: reject Riot-bound requests during the fresh window.
    const syncMetadata = await getPlayerSyncMetadata(puuid);
    const gateResult = checkSyncGate(syncMetadata?.last_riot_sync_at ?? null);
    if (gateResult) {
      return NextResponse.json(gateResult, { status: 429 });
    }

    const matchIds = await getMatchHistory(puuid, count, start);
    return NextResponse.json(matchIds);
  } catch (error) {
    console.error("Error in GET /api/match-history:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** Neon client factory for analytics instrumentation. */
function analyticsNeonClient() {
  return { sql: getSql() };
}

export const GET = instrumentRoute("/api/match-history", _GET, analyticsNeonClient);
