import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/neon";
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

  const sql = getSql();
  const params = request.nextUrl.searchParams;
  const startOffsetRaw = Number.parseInt(params.get("offset") || "0", 10);
  const requestedLimit = Number.parseInt(params.get("limit") || "1000", 10);
  const limit = Math.min(Math.max(Number.isNaN(requestedLimit) ? 1000 : requestedLimit, 1), 1000);
  const PAGE_SIZE = 500;
  const CHUNK = 50;
  const startOffset = Number.isNaN(startOffsetRaw) ? 0 : Math.max(startOffsetRaw, 0);
  let offset = startOffset;
  const targetEndOffset = offset + limit;
  let totalImpactRows = 0;
  let backfilled = 0;
  let skippedMissingData = 0;
  let skippedErrors = 0;
  let totalMatchDetails = 0;
  let totalTimelines = 0;

  while (true) {
    let impactRows: Array<{ match_id: string; puuid: string }>;
    try {
      impactRows = await sql`
        SELECT match_id, puuid FROM impact_categories
        ORDER BY match_id
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      ` as Array<{ match_id: string; puuid: string }>;
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to read impact_categories", detail: err instanceof Error ? err.message : String(err) },
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
      try {
        const [detailsRows, timelinesRows, cacheRows] = await Promise.all([
          sql`
            SELECT match_id, match_data FROM match_details
            WHERE match_id = ANY(${chunk})
          `,
          sql`
            SELECT match_id, timeline_data FROM match_timelines
            WHERE match_id = ANY(${chunk})
          `,
          sql`
            SELECT match_id, match_data, timeline_data FROM match_cache
            WHERE match_id = ANY(${chunk})
          `,
        ]);

        for (const d of detailsRows as Array<{ match_id: string; match_data: MatchDto }>) {
          detailsMap.set(d.match_id, d.match_data);
        }
        for (const t of timelinesRows as Array<{ match_id: string; timeline_data: MatchTimelineDto }>) {
          timelinesMap.set(t.match_id, t.timeline_data);
        }
        for (const c of cacheRows as Array<{ match_id: string; match_data: MatchDto; timeline_data: MatchTimelineDto }>) {
          cacheMap.set(c.match_id, {
            match_data: c.match_data,
            timeline_data: c.timeline_data,
          });
        }
      } catch (err) {
        console.error("Backfill chunk query failed:", err);
        return NextResponse.json(
          { error: "Backfill query failed; see server logs for details." },
          { status: 500 }
        );
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
        skippedMissingData++;
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

        const userParticipant = matchDetails.info.participants.find(
          (p) => p.puuid === puuid
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
          rank: summary.rank,
          rank_queue: summary.rankQueue,
          role: summary.role,
          damage_to_champions: summary.damageToChampions,
          is_remake: userParticipant?.gameEndedInEarlySurrender === true || (!(userParticipant && "gameEndedInEarlySurrender" in userParticipant) && matchDetails.info.gameDuration < 300),
        });
      } catch (err) {
        console.error("Backfill row reconstruction failed:", err);
        skippedErrors++;
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
    if (impactRows.length < PAGE_SIZE || offset + impactRows.length >= targetEndOffset) {
      break;
    }
    offset += PAGE_SIZE;
  }

  // Resume pointer should reflect the actual table cursor, not a derived count.
  const nextOffset = totalImpactRows >= limit ? offset + PAGE_SIZE : null;
  return NextResponse.json({
    backfilled,
    skipped: skippedMissingData + skippedErrors,
    skippedMissingData,
    skippedErrors,
    totalImpactRows,
    totalMatchDetails,
    totalTimelines,
    nextOffset,
  });
}
