import { NextRequest, NextResponse } from "next/server";
import { getMatchHistory } from "@/lib/riot-api-service";
import {
  getValidationFixtureMatchHistory,
  VALIDATION_FIXTURE_ACCOUNT,
} from "@/lib/validation-fixture";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const count = parseInt(searchParams.get("count") ?? "10", 10);
  const start = parseInt(searchParams.get("start") ?? "0", 10);

  if (!puuid) {
    return NextResponse.json({ error: "Missing puuid" }, { status: 400 });
  }

  try {
    if (puuid === VALIDATION_FIXTURE_ACCOUNT.puuid) {
      return NextResponse.json(getValidationFixtureMatchHistory(count, start));
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
