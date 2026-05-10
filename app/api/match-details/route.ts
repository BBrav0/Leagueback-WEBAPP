import { NextRequest, NextResponse } from "next/server";
import { getMatchDetailsData } from "@/lib/database-queries";
import {
  VALIDATION_FIXTURE_ACCOUNT,
  VALIDATION_FIXTURE_DETAILS,
} from "@/lib/validation-fixture";
import { instrumentRoute } from "@/lib/analytics-instrumentation";
import { getSql } from "@/lib/neon";

async function _GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  const userPuuid = searchParams.get("userPuuid");

  if (!matchId || !userPuuid) {
    return NextResponse.json(
      { error: "Missing matchId or userPuuid" },
      { status: 400 }
    );
  }

  try {
    if (userPuuid === VALIDATION_FIXTURE_ACCOUNT.puuid && VALIDATION_FIXTURE_DETAILS[matchId]) {
      return NextResponse.json({ details: VALIDATION_FIXTURE_DETAILS[matchId] });
    }

    const details = await getMatchDetailsData(matchId, userPuuid);
    return NextResponse.json({ details });
  } catch (error) {
    console.error("Error fetching match details:", error);
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

export const GET = instrumentRoute("/api/match-details", _GET, analyticsNeonClient);
