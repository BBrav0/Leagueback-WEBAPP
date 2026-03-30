import { NextRequest, NextResponse } from "next/server";
import { getMatchDetailsData } from "@/lib/database-queries";

export async function GET(request: NextRequest) {
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
