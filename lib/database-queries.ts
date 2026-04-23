import { getSql } from "./neon";
import type {
  ImpactCategory,
  MatchDetailsData,
  MatchDto,
  MatchSummary,
  MatchTimelineDto,
} from "./types";
import { buildMatchMetadata } from "./match-reconstruction";
import { buildMatchDetailsData, buildUnavailableMatchDetailsData } from "./match-details";

export interface PlayerMatchRow {
  match_id: string;
  puuid: string;
  summoner_name: string;
  champion: string;
  kda: string;
  cs: number;
  vision_score: number;
  game_result: "Victory" | "Defeat";
  game_time: string;
  your_impact: number;
  team_impact: number;
  impact_category: ImpactCategory;
  chart_data: Array<{ minute: number; yourImpact: number; teamImpact: number }>;
  game_creation: number;
  game_duration: number;
  rank: string | null;
  rank_queue: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR" | null;
  role: string | null;
  damage_to_champions: number | null;
  is_remake?: boolean;
}

export interface PlayerSyncMetadataRow {
  puuid: string;
  latest_riot_match_id?: string | null;
  latest_riot_match_created_at?: number | null;
  latest_db_match_id?: string | null;
  latest_db_match_created_at?: number | null;
  recent_match_window?: number;
  reconciled_through_match_created_at?: number | null;
  last_riot_sync_at?: string | Date | null;
  last_full_refresh_at?: string | Date | null;
  last_stale_derived_refresh_at?: string | Date | null;
  last_known_account_game_name?: string | null;
  last_known_account_tag_line?: string | null;
  derivation_version?: string | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  notes?: Record<string, unknown>;
}

export interface PlayerMatchStaleCheckRow {
  match_id: string;
  game_creation: number;
  game_duration: number;
  created_at?: string | null;
}

function rowToMatchSummary(row: PlayerMatchRow): MatchSummary {
  const metadata = buildMatchMetadata({
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    teamPosition: row.role ?? undefined,
    totalDamageDealtToChampions: row.damage_to_champions ?? undefined,
    impactCategory: row.impact_category,
    rank: row.rank,
    rankLabel: row.rank
      ? `Current rank snapshot (${row.rank_queue === "RANKED_SOLO_5x5" ? "Solo/Duo" : row.rank_queue === "RANKED_FLEX_SR" ? "Flex" : "current queue"})`
      : "Current rank snapshot unavailable",
    rankQueue: row.rank_queue,
  });

  return {
    id: row.match_id,
    summonerName: row.summoner_name,
    champion: row.champion,
    ...metadata,
    kda: row.kda,
    cs: row.cs,
    visionScore: row.vision_score,
    gameResult: row.game_result,
    gameTime: row.game_time,
    data: row.chart_data,
    yourImpact: row.your_impact,
    teamImpact: row.team_impact,
    isRemake: row.is_remake ?? false,
  };
}

/**
 * Get paginated precomputed matches for a player, ordered by game time (newest first).
 * Uses COUNT(*) OVER() window function to get total count in a single query.
 */
export async function getPlayerMatchesPaginated(
  puuid: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ matches: MatchSummary[]; totalCount: number; hasMore: boolean }> {
  const sql = getSql();

  // Use .query() with explicit $N parameters to avoid LIMIT/OFFSET
  // type-inference issues on the Neon HTTP driver (Cloudflare Workers).
  const rows = await sql.query(
    `SELECT *, COUNT(*) OVER()::int AS total_count FROM player_matches
     WHERE puuid = $1 AND is_remake = false
     ORDER BY game_creation DESC
     LIMIT $2 OFFSET $3`,
    [puuid, limit, offset]
  );

  const typedRows = rows as (PlayerMatchRow & { total_count: number })[];
  const totalCount = typedRows[0]?.total_count ?? 0;
  const matches = typedRows.map(rowToMatchSummary);
  const hasMore = offset + matches.length < totalCount;

  return { matches, totalCount, hasMore };
}

/**
 * Upsert a precomputed match summary into player_matches.
 */
export async function upsertPlayerMatch(row: PlayerMatchRow): Promise<string | null> {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO player_matches (
        match_id, puuid, summoner_name, champion, kda, cs, vision_score,
        game_result, game_time, your_impact, team_impact, impact_category,
        chart_data, game_creation, game_duration, rank, rank_queue, role,
        damage_to_champions, is_remake
      ) VALUES (
        ${row.match_id}, ${row.puuid}, ${row.summoner_name}, ${row.champion},
        ${row.kda}, ${row.cs}, ${row.vision_score}, ${row.game_result},
        ${row.game_time}, ${row.your_impact}, ${row.team_impact},
        ${row.impact_category}, ${JSON.stringify(row.chart_data)}::jsonb,
        ${row.game_creation}, ${row.game_duration}, ${row.rank},
        ${row.rank_queue}, ${row.role}, ${row.damage_to_champions},
        ${row.is_remake ?? false}
      )
      ON CONFLICT (match_id, puuid) DO UPDATE SET
        summoner_name = EXCLUDED.summoner_name,
        champion = EXCLUDED.champion,
        kda = EXCLUDED.kda,
        cs = EXCLUDED.cs,
        vision_score = EXCLUDED.vision_score,
        game_result = EXCLUDED.game_result,
        game_time = EXCLUDED.game_time,
        your_impact = EXCLUDED.your_impact,
        team_impact = EXCLUDED.team_impact,
        impact_category = EXCLUDED.impact_category,
        chart_data = EXCLUDED.chart_data,
        game_creation = EXCLUDED.game_creation,
        game_duration = EXCLUDED.game_duration,
        rank = EXCLUDED.rank,
        rank_queue = EXCLUDED.rank_queue,
        role = EXCLUDED.role,
        damage_to_champions = EXCLUDED.damage_to_champions,
        is_remake = EXCLUDED.is_remake
    `;
    return null;
  } catch (error) {
    console.error("player_matches upsert failed:", error);
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Batch upsert precomputed match summaries.
 */
export async function upsertPlayerMatchBatch(
  rows: PlayerMatchRow[]
): Promise<string | null> {
  if (rows.length === 0) return null;

  try {
    const sql = getSql();

    // Build a multi-row INSERT with parameterized values
    const valuesClauses: string[] = [];
    const params: unknown[] = [];

    for (const row of rows) {
      const baseIdx = params.length;
      params.push(
        row.match_id, row.puuid, row.summoner_name, row.champion,
        row.kda, row.cs, row.vision_score, row.game_result,
        row.game_time, row.your_impact, row.team_impact,
        row.impact_category, JSON.stringify(row.chart_data),
        row.game_creation, row.game_duration, row.rank,
        row.rank_queue, row.role, row.damage_to_champions,
        row.is_remake ?? false
      );
      valuesClauses.push(
        `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8}, $${baseIdx + 9}, $${baseIdx + 10}, $${baseIdx + 11}, $${baseIdx + 12}, $${baseIdx + 13}::jsonb, $${baseIdx + 14}, $${baseIdx + 15}, $${baseIdx + 16}, $${baseIdx + 17}, $${baseIdx + 18}, $${baseIdx + 19}, $${baseIdx + 20})`
      );
    }

    const query = `
      INSERT INTO player_matches (
        match_id, puuid, summoner_name, champion, kda, cs, vision_score,
        game_result, game_time, your_impact, team_impact, impact_category,
        chart_data, game_creation, game_duration, rank, rank_queue, role,
        damage_to_champions, is_remake
      ) VALUES ${valuesClauses.join(", ")}
      ON CONFLICT (match_id, puuid) DO UPDATE SET
        summoner_name = EXCLUDED.summoner_name,
        champion = EXCLUDED.champion,
        kda = EXCLUDED.kda,
        cs = EXCLUDED.cs,
        vision_score = EXCLUDED.vision_score,
        game_result = EXCLUDED.game_result,
        game_time = EXCLUDED.game_time,
        your_impact = EXCLUDED.your_impact,
        team_impact = EXCLUDED.team_impact,
        impact_category = EXCLUDED.impact_category,
        chart_data = EXCLUDED.chart_data,
        game_creation = EXCLUDED.game_creation,
        game_duration = EXCLUDED.game_duration,
        rank = EXCLUDED.rank,
        rank_queue = EXCLUDED.rank_queue,
        role = EXCLUDED.role,
        damage_to_champions = EXCLUDED.damage_to_champions,
        is_remake = EXCLUDED.is_remake
    `;

    await sql.query(query, params);
    return null;
  } catch (error) {
    console.error("player_matches batch upsert failed:", error);
    return error instanceof Error ? error.message : String(error);
  }
}

export async function getPlayerSyncMetadata(
  puuid: string
): Promise<PlayerSyncMetadataRow | null> {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT * FROM player_sync_metadata WHERE puuid = ${puuid}
    `;
    return (rows as PlayerSyncMetadataRow[])[0] ?? null;
  } catch (error) {
    console.error("Error fetching player sync metadata:", error);
    return null;
  }
}

export async function upsertPlayerSyncMetadata(
  row: PlayerSyncMetadataRow
): Promise<string | null> {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO player_sync_metadata (
        puuid, latest_riot_match_id, latest_riot_match_created_at,
        latest_db_match_id, latest_db_match_created_at, recent_match_window,
        reconciled_through_match_created_at, last_riot_sync_at,
        last_full_refresh_at, last_stale_derived_refresh_at,
        last_known_account_game_name, last_known_account_tag_line,
        derivation_version, notes
      ) VALUES (
        ${row.puuid}, ${row.latest_riot_match_id ?? null},
        ${row.latest_riot_match_created_at ?? null},
        ${row.latest_db_match_id ?? null},
        ${row.latest_db_match_created_at ?? null},
        ${row.recent_match_window ?? null},
        ${row.reconciled_through_match_created_at ?? null},
        ${row.last_riot_sync_at ?? null},
        ${row.last_full_refresh_at ?? null},
        ${row.last_stale_derived_refresh_at ?? null},
        ${row.last_known_account_game_name ?? null},
        ${row.last_known_account_tag_line ?? null},
        ${row.derivation_version ?? null},
        ${row.notes != null ? JSON.stringify(row.notes) : null}::jsonb
      )
      ON CONFLICT (puuid) DO UPDATE SET
        latest_riot_match_id = EXCLUDED.latest_riot_match_id,
        latest_riot_match_created_at = EXCLUDED.latest_riot_match_created_at,
        latest_db_match_id = EXCLUDED.latest_db_match_id,
        latest_db_match_created_at = EXCLUDED.latest_db_match_created_at,
        recent_match_window = EXCLUDED.recent_match_window,
        reconciled_through_match_created_at = EXCLUDED.reconciled_through_match_created_at,
        last_riot_sync_at = EXCLUDED.last_riot_sync_at,
        last_full_refresh_at = EXCLUDED.last_full_refresh_at,
        last_stale_derived_refresh_at = EXCLUDED.last_stale_derived_refresh_at,
        last_known_account_game_name = EXCLUDED.last_known_account_game_name,
        last_known_account_tag_line = EXCLUDED.last_known_account_tag_line,
        derivation_version = EXCLUDED.derivation_version,
        notes = EXCLUDED.notes
    `;
    return null;
  } catch (error) {
    console.error("player_sync_metadata upsert failed:", error);
    return error instanceof Error ? error.message : String(error);
  }
}

export async function getPlayerMatchRowsForStaleCheck(
  puuid: string,
  matchIds: string[]
): Promise<PlayerMatchStaleCheckRow[]> {
  if (matchIds.length === 0) {
    return [];
  }

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT match_id, game_creation, game_duration, created_at
      FROM player_matches
      WHERE puuid = ${puuid} AND match_id = ANY(${matchIds})
    `;
    return rows as PlayerMatchStaleCheckRow[];
  } catch (error) {
    console.error("Error fetching player matches for stale check:", error);
    return [];
  }
}

/**
 * Get all stored match IDs for a player from player_matches.
 */
export async function getAllStoredMatchIds(puuid: string): Promise<string[]> {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT match_id FROM player_matches
      WHERE puuid = ${puuid}
      ORDER BY game_creation DESC
    `;
    return (rows as [{ match_id: string }]).map((row) => row.match_id);
  } catch (error) {
    console.error("Error fetching stored match IDs:", error);
    return [];
  }
}

/**
 * Get all impact categories for a user (for lifetime stats).
 */
export async function getImpactCategoriesForUser(
  puuid: string
): Promise<ImpactCategory[]> {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT impact_category FROM player_matches
      WHERE puuid = ${puuid} AND is_remake = false
    `;
    return (rows as [{ impact_category: ImpactCategory }]).map((row) => row.impact_category);
  } catch (error) {
    console.error("Error fetching impact categories:", error);
    return [];
  }
}

/**
 * Get impact categories for the last N matches (for pie chart).
 */
export async function getRecentImpactCategories(
  puuid: string,
  limit: number = 10
): Promise<ImpactCategory[]> {
  try {
    const sql = getSql();
    // Use .query() with explicit $N parameters to avoid LIMIT
    // type-inference issues on the Neon HTTP driver (Cloudflare Workers).
    const rows = await sql.query(
      `SELECT impact_category FROM player_matches
       WHERE puuid = $1 AND is_remake = false
       ORDER BY game_creation DESC
       LIMIT $2`,
      [puuid, limit]
    );
    return (rows as [{ impact_category: ImpactCategory }]).map((row) => row.impact_category);
  } catch (error) {
    console.error("Error fetching recent impact categories:", error);
    return [];
  }
}

export async function getMatchCacheEntry(matchId: string): Promise<{
  matchData: MatchDto | null;
  timelineData: MatchTimelineDto | null;
}> {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT match_data, timeline_data FROM match_cache
      WHERE match_id = ${matchId}
    `;
    const row = (rows as [{ match_data: MatchDto; timeline_data: MatchTimelineDto }])[0];
    return {
      matchData: row?.match_data ?? null,
      timelineData: row?.timeline_data ?? null,
    };
  } catch (error) {
    console.error("Error fetching match_cache entry:", error);
    return { matchData: null, timelineData: null };
  }
}

export async function getMatchDetailsData(
  matchId: string,
  currentPuuid: string
): Promise<MatchDetailsData> {
  const cacheEntry = await getMatchCacheEntry(matchId);

  if (cacheEntry.matchData) {
    return buildMatchDetailsData(matchId, currentPuuid, cacheEntry.matchData, "match_cache");
  }

  const detailsMap = await getStoredMatchDetails([matchId]);
  const legacyMatchDetails = detailsMap.get(matchId) ?? null;

  if (legacyMatchDetails) {
    return buildMatchDetailsData(matchId, currentPuuid, legacyMatchDetails, "legacy_cache");
  }

  return buildUnavailableMatchDetailsData(matchId);
}

// ---------------------------------------------------------------------------
// Legacy helpers -- used by backfill and match-performance ingest only
// ---------------------------------------------------------------------------

export async function getStoredMatchDetails(
  matchIds: string[]
): Promise<Map<string, MatchDto>> {
  const matchMap = new Map<string, MatchDto>();
  if (matchIds.length === 0) return matchMap;

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT match_id, match_data FROM match_details
      WHERE match_id = ANY(${matchIds})
    `;
    for (const row of rows as [{ match_id: string; match_data: MatchDto }]) {
      matchMap.set(row.match_id, row.match_data);
    }
  } catch (error) {
    console.error("Error fetching match details:", error);
  }
  return matchMap;
}

export async function getStoredMatchTimelines(
  matchIds: string[]
): Promise<Map<string, MatchTimelineDto>> {
  const timelineMap = new Map<string, MatchTimelineDto>();
  if (matchIds.length === 0) return timelineMap;

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT match_id, timeline_data FROM match_timelines
      WHERE match_id = ANY(${matchIds})
    `;
    for (const row of rows as [{ match_id: string; timeline_data: MatchTimelineDto }]) {
      timelineMap.set(row.match_id, row.timeline_data);
    }
  } catch (error) {
    console.error("Error fetching match timelines:", error);
  }
  return timelineMap;
}
