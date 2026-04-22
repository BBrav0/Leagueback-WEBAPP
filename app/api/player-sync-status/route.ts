import { NextRequest, NextResponse } from "next/server";
import { getPlayerSyncMetadata, upsertPlayerSyncMetadata } from "@/lib/database-queries";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get("puuid");

  if (!puuid) {
    return NextResponse.json(
      { error: "Missing puuid" },
      { status: 400 }
    );
  }

  try {
    const metadata = await getPlayerSyncMetadata(puuid);
    return NextResponse.json({ lastSyncAt: metadata?.last_riot_sync_at ?? null });
  } catch (error) {
    console.error("Error fetching player sync status:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { puuid?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { puuid } = body;
  if (!puuid) {
    return NextResponse.json(
      { error: "Missing puuid" },
      { status: 400 }
    );
  }

  try {
    const existing = await getPlayerSyncMetadata(puuid);
    const now = new Date().toISOString();

    const upsertError = await upsertPlayerSyncMetadata({
      puuid,
      latest_riot_match_id: existing?.latest_riot_match_id ?? null,
      latest_riot_match_created_at: existing?.latest_riot_match_created_at ?? null,
      latest_db_match_id: existing?.latest_db_match_id ?? null,
      latest_db_match_created_at: existing?.latest_db_match_created_at ?? null,
      recent_match_window: existing?.recent_match_window ?? 25,
      reconciled_through_match_created_at: existing?.reconciled_through_match_created_at ?? null,
      last_known_account_game_name: existing?.last_known_account_game_name ?? null,
      last_known_account_tag_line: existing?.last_known_account_tag_line ?? null,
      derivation_version: existing?.derivation_version ?? null,
      last_stale_derived_refresh_at: existing?.last_stale_derived_refresh_at ?? null,
      last_full_refresh_at: existing?.last_full_refresh_at ?? null,
      last_riot_sync_at: now,
      notes: existing?.notes ?? {},
    });

    if (upsertError) {
      console.error("player_sync_metadata upsert failed:", upsertError);
      return NextResponse.json(
        { error: upsertError },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, lastSyncAt: now });
  } catch (error) {
    console.error("Error updating player sync status:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
