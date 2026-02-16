import { NextRequest, NextResponse } from "next/server";
import { getImpactCategoriesForUser, getRecentImpactCategories } from "@/lib/database-queries";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");
  const limitParam = searchParams.get("limit");

  if (!puuid) {
    return NextResponse.json(
      { error: "Missing puuid" },
      { status: 400 }
    );
  }

  try {
    let categories;
    if (limitParam) {
      const limit = parseInt(limitParam, 10);
      categories = await getRecentImpactCategories(puuid, limit);
    } else {
      categories = await getImpactCategoriesForUser(puuid);
    }
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Error fetching impact categories:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
