import { NextRequest, NextResponse } from "next/server";
import { getAccountByRiotId } from "@/lib/riot-api-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawGameName = searchParams.get("gameName");
  const rawTagLine = searchParams.get("tagLine");
  const gameName = rawGameName?.trim() ?? "";
  const tagLine = rawTagLine?.trim() ?? "";

  if (!gameName || !tagLine) {
    return NextResponse.json(
      { error: "Missing gameName or tagLine" },
      { status: 400 }
    );
  }

  try {
    const account = await getAccountByRiotId(gameName, tagLine);
    return NextResponse.json(account);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Rate limit exceeded. Try again later.") {
      return NextResponse.json({ error: message }, { status: 429 });
    }
    if (
      message === "Account not found" ||
      message.startsWith("Data not found") ||
      message.includes("No results found")
    ) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
