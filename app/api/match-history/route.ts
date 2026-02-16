import { NextRequest, NextResponse } from "next/server";
import { getMatchHistory } from "@/lib/riot-api-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const count = parseInt(searchParams.get("count") ?? "10", 10);

  if (!puuid) {
    return NextResponse.json({ error: "Missing puuid" }, { status: 400 });
  }

  try {
    const matchIds = await getMatchHistory(puuid, count);
    return NextResponse.json(matchIds);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
