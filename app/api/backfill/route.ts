import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  reconstructMatchSummary,
  determineImpactCategory,
} from "@/lib/match-reconstruction";
import { upsertPlayerMatchBatch } from "@/lib/database-queries";
import type { PlayerMatchRow } from "@/lib/database-queries";
import type { MatchDto, MatchTimelineDto } from "@/lib/types";

export async function POST() {
  const supabase = getSupabaseServer();

  const { data: impactRows, error: impactError } = await supabase
    .from("impact_categories")
    .select("match_id, puuid");

  if (impactError || !impactRows) {
    return NextResponse.json(
      { error: "Failed to read impact_categories", detail: impactError?.message },
      { status: 500 }
    );
  }

  const uniqueMatchIds = [...new Set(impactRows.map((r) => r.match_id))];

  const detailsMap = new Map<string, MatchDto>();
  const timelinesMap = new Map<string, MatchTimelineDto>();

  const CHUNK = 50;
  for (let i = 0; i < uniqueMatchIds.length; i += CHUNK) {
    const chunk = uniqueMatchIds.slice(i, i + CHUNK);

    const [{ data: details }, { data: timelines }] = await Promise.all([
      supabase
        .from("match_details")
        .select("match_id, match_data")
        .in("match_id", chunk),
      supabase
        .from("match_timelines")
        .select("match_id, timeline_data")
        .in("match_id", chunk),
    ]);

    for (const d of details ?? []) {
      detailsMap.set(d.match_id, d.match_data as MatchDto);
    }
    for (const t of timelines ?? []) {
      timelinesMap.set(t.match_id, t.timeline_data as MatchTimelineDto);
    }
  }

  const rows: PlayerMatchRow[] = [];
  const skipped: string[] = [];

  for (const { match_id, puuid } of impactRows) {
    const matchDetails = detailsMap.get(match_id);
    const matchTimeline = timelinesMap.get(match_id);

    if (!matchDetails || !matchTimeline) {
      skipped.push(match_id);
      continue;
    }

    try {
      const summary = reconstructMatchSummary(
        match_id,
        puuid,
        matchDetails,
        matchTimeline
      );

      const category = determineImpactCategory(
        summary.gameResult,
        summary.yourImpact,
        summary.teamImpact
      );

      rows.push({
        match_id,
        puuid,
        summoner_name: summary.summonerName,
        champion: summary.champion,
        kda: summary.kda,
        cs: summary.cs,
        vision_score: summary.visionScore,
        game_result: summary.gameResult,
        game_time: summary.gameTime,
        your_impact: summary.yourImpact,
        team_impact: summary.teamImpact,
        impact_category: category,
        chart_data: summary.data,
        game_creation: matchDetails.info.gameCreation ?? 0,
        game_duration: matchDetails.info.gameDuration,
      });
    } catch (err) {
      skipped.push(`${match_id}:${puuid}`);
    }
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    await upsertPlayerMatchBatch(rows.slice(i, i + CHUNK));
  }

  return NextResponse.json({
    backfilled: rows.length,
    skipped: skipped.length,
    skippedIds: skipped,
    totalImpactRows: impactRows.length,
    totalMatchDetails: detailsMap.size,
    totalTimelines: timelinesMap.size,
  });
}
