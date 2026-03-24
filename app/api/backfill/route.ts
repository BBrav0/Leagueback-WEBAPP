import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  reconstructMatchSummary,
  determineImpactCategory,
} from "@/lib/match-reconstruction";
import { upsertPlayerMatchBatch } from "@/lib/database-queries";
import type { PlayerMatchRow } from "@/lib/database-queries";
import type { MatchDto, MatchTimelineDto } from "@/lib/types";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.BACKFILL_SECRET;
  const providedSecret = request.headers.get("x-backfill-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServer();
  const PAGE_SIZE = 500;
  const CHUNK = 50;
  let offset = 0;
  let totalImpactRows = 0;
  let backfilled = 0;
  let skipped = 0;
  let totalMatchDetails = 0;
  let totalTimelines = 0;

  while (true) {
    const { data: impactRows, error: impactError } = await supabase
      .from("impact_categories")
      .select("match_id, puuid")
      .range(offset, offset + PAGE_SIZE - 1);

    if (impactError) {
      return NextResponse.json(
        { error: "Failed to read impact_categories", detail: impactError.message },
        { status: 500 }
      );
    }

    if (!impactRows || impactRows.length === 0) {
      break;
    }

    totalImpactRows += impactRows.length;
    const uniqueMatchIds = [...new Set(impactRows.map((r) => r.match_id))];
    const detailsMap = new Map<string, MatchDto>();
    const timelinesMap = new Map<string, MatchTimelineDto>();
    const cacheMap = new Map<string, { match_data: MatchDto; timeline_data: MatchTimelineDto }>();

    for (let i = 0; i < uniqueMatchIds.length; i += CHUNK) {
      const chunk = uniqueMatchIds.slice(i, i + CHUNK);
      const [detailsRes, timelinesRes, cacheRes] = await Promise.all([
        supabase
          .from("match_details")
          .select("match_id, match_data")
          .in("match_id", chunk),
        supabase
          .from("match_timelines")
          .select("match_id, timeline_data")
          .in("match_id", chunk),
        supabase
          .from("match_cache")
          .select("match_id, match_data, timeline_data")
          .in("match_id", chunk),
      ]);

      if (detailsRes.error || timelinesRes.error || cacheRes.error) {
        console.error("Backfill chunk query failed", {
          detailsError: detailsRes.error?.message,
          timelinesError: timelinesRes.error?.message,
          cacheError: cacheRes.error?.message,
        });
        return NextResponse.json(
          { error: "Backfill query failed; see server logs for details." },
          { status: 500 }
        );
      }

      for (const d of detailsRes.data ?? []) {
        detailsMap.set(d.match_id, d.match_data as MatchDto);
      }
      for (const t of timelinesRes.data ?? []) {
        timelinesMap.set(t.match_id, t.timeline_data as MatchTimelineDto);
      }
      for (const c of cacheRes.data ?? []) {
        cacheMap.set(c.match_id, {
          match_data: c.match_data as MatchDto,
          timeline_data: c.timeline_data as MatchTimelineDto,
        });
      }
    }

    totalMatchDetails += detailsMap.size;
    totalTimelines += timelinesMap.size;

    const rows: PlayerMatchRow[] = [];
    for (const { match_id, puuid } of impactRows) {
      const cache = cacheMap.get(match_id);
      const matchDetails = cache?.match_data ?? detailsMap.get(match_id);
      const matchTimeline = cache?.timeline_data ?? timelinesMap.get(match_id);

      if (!matchDetails || !matchTimeline) {
        skipped++;
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
        console.error("Backfill row reconstruction failed:", err);
        skipped++;
      }
    }

    for (let i = 0; i < rows.length; i += CHUNK) {
      const upsertError = await upsertPlayerMatchBatch(rows.slice(i, i + CHUNK));
      if (upsertError) {
        return NextResponse.json(
          { error: "Backfill upsert failed", detail: upsertError },
          { status: 500 }
        );
      }
    }

    backfilled += rows.length;
    if (impactRows.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return NextResponse.json({
    backfilled,
    skipped,
    totalImpactRows,
    totalMatchDetails,
    totalTimelines,
  });
}
