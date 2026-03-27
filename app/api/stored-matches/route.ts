import { NextRequest, NextResponse } from "next/server";
import { getPlayerMatchesPaginated } from "@/lib/database-queries";

export async function GET(request: NextRequest) {
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
    const { matches, totalCount, hasMore } = await getPlayerMatchesPaginated(
      puuid,
      limit,
      offset
    );

    return NextResponse.json({ matches, totalCount, hasMore });
  } catch (error) {
    console.error("Error fetching stored matches:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
