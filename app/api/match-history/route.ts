import { NextRequest, NextResponse } from "next/server";
import { getMatchHistory } from "@/lib/riot-api-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const count = parseInt(searchParams.get("count") ?? "10", 10);
  const start = parseInt(searchParams.get("start") ?? "0", 10);

  if (!puuid) {
    return NextResponse.json({ error: "Missing puuid" }, { status: 400 });
  }

  try {
    const matchIds = await getMatchHistory(puuid, count, start);
    const head = matchIds[0]?.slice(0, 14) ?? "none";
    console.info(
      "[match-history]",
      `puuid=${puuid.slice(0, 8)}… count=${count} start→${start} returned=${matchIds.length} head=${head}…`
    );
    return NextResponse.json(matchIds);
  } catch (error) {
    console.error(
      "[match-history] error",
      { puuid: puuid!.slice(0, 8), count, start },
      error
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
