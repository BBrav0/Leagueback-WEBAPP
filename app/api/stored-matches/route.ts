import { NextRequest, NextResponse } from "next/server";
import { getPlayerMatchesPaginated } from "@/lib/database-queries";
import {
  getValidationFixtureStoredMatches,
  VALIDATION_FIXTURE_ACCOUNT,
} from "@/lib/validation-fixture";
import { instrumentRoute } from "@/lib/analytics-instrumentation";
import { getSql } from "@/lib/neon";

async function _GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  if (!puuid) {
    return NextResponse.json(
      { error: "Missing puuid" },
      { status: 400 }
    );
  }

  const parsedLimit = limitParam ? parseInt(limitParam, 10) : 20;
  const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 20 : parsedLimit, 1), 100);
  const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

  try {
    if (puuid === VALIDATION_FIXTURE_ACCOUNT.puuid) {
      return NextResponse.json({
        ...getValidationFixtureStoredMatches(limit, offset),
        readFailed: false,
      });
    }

    const { matches, totalCount, hasMore } = await getPlayerMatchesPaginated(
      puuid,
      limit,
      offset
    );

    return NextResponse.json({ matches, totalCount, hasMore, readFailed: false });
  } catch (error) {
    console.error("Error fetching stored matches:", error);
    return NextResponse.json(
      {
        matches: [],
        totalCount: 0,
        hasMore: false,
        readFailed: true,
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

export const GET = instrumentRoute("/api/stored-matches", _GET, analyticsNeonClient);
