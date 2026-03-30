import { getSupabaseServer } from "./supabase-server";
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
}

export interface PlayerSyncMetadataRow {
  puuid: string;
  latest_riot_match_id?: string | null;
  latest_riot_match_created_at?: number | null;
  latest_db_match_id?: string | null;
  latest_db_match_created_at?: number | null;
  recent_match_window?: number;
  reconciled_through_match_created_at?: number | null;
  last_riot_sync_at?: string | null;
  last_full_refresh_at?: string | null;
  last_stale_derived_refresh_at?: string | null;
  last_known_account_game_name?: string | null;
  last_known_account_tag_line?: string | null;
  derivation_version?: string | null;
  notes?: Record<string, unknown>;
}

function rowToMatchSummary(row: PlayerMatchRow): MatchSummary {
  const metadata = buildMatchMetadata({
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    impactCategory: row.impact_category,
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
  };
}

/**
 * Get paginated precomputed matches for a player, ordered by game time (newest first).
 */
export async function getPlayerMatchesPaginated(
  puuid: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ matches: MatchSummary[]; totalCount: number; hasMore: boolean }> {
  const supabase = getSupabaseServer();

  const { data, error, count } = await supabase
    .from("player_matches")
    .select("*", { count: "exact" })
    .eq("puuid", puuid)
    .order("game_creation", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Error fetching player matches:", error);
    return { matches: [], totalCount: count || 0, hasMore: false };
  }

  const matches = (data as PlayerMatchRow[]).map(rowToMatchSummary);
  const totalCount = count || 0;
  const hasMore = offset + matches.length < totalCount;

  return { matches, totalCount, hasMore };
}

/**
 * Upsert a precomputed match summary into player_matches.
 */
export async function upsertPlayerMatch(row: PlayerMatchRow): Promise<string | null> {
  const { error } = await getSupabaseServer()
    .from("player_matches")
    .upsert(row, { onConflict: "match_id,puuid" });

  if (error) {
    console.error("player_matches upsert failed:", error);
    return error.message;
  }
  return null;
}

/**
 * Batch upsert precomputed match summaries.
 */
export async function upsertPlayerMatchBatch(
  rows: PlayerMatchRow[]
): Promise<string | null> {
  if (rows.length === 0) return null;

  const { error } = await getSupabaseServer()
    .from("player_matches")
    .upsert(rows, { onConflict: "match_id,puuid" });

  if (error) {
    console.error("player_matches batch upsert failed:", error);
    return error.message;
  }
  return null;
}

export async function getPlayerSyncMetadata(
  puuid: string
): Promise<PlayerSyncMetadataRow | null> {
  const { data, error } = await getSupabaseServer()
    .from("player_sync_metadata")
    .select("*")
    .eq("puuid", puuid)
    .maybeSingle();

  if (error) {
    console.error("Error fetching player sync metadata:", error);
    return null;
  }

  return (data as PlayerSyncMetadataRow | null) ?? null;
}

export async function upsertPlayerSyncMetadata(
  row: PlayerSyncMetadataRow
): Promise<string | null> {
  const { error } = await getSupabaseServer()
    .from("player_sync_metadata")
    .upsert(row, { onConflict: "puuid" });

  if (error) {
    console.error("player_sync_metadata upsert failed:", error);
    return error.message;
  }

  return null;
}

/**
 * Get all stored match IDs for a player from player_matches.
 */
export async function getAllStoredMatchIds(puuid: string): Promise<string[]> {
  const { data, error } = await getSupabaseServer()
    .from("player_matches")
    .select("match_id")
    .eq("puuid", puuid)
    .order("game_creation", { ascending: false });

  if (error) {
    console.error("Error fetching stored match IDs:", error);
    return [];
  }

  return data.map((row) => row.match_id);
}

/**
 * Get all impact categories for a user (for lifetime stats).
 */
export async function getImpactCategoriesForUser(
  puuid: string
): Promise<ImpactCategory[]> {
  const { data, error } = await getSupabaseServer()
    .from("player_matches")
    .select("impact_category")
    .eq("puuid", puuid);

  if (error) {
    console.error("Error fetching impact categories:", error);
    return [];
  }

  return data.map((row) => row.impact_category as ImpactCategory);
}

/**
 * Get impact categories for the last N matches (for pie chart).
 */
export async function getRecentImpactCategories(
  puuid: string,
  limit: number = 10
): Promise<ImpactCategory[]> {
  const { data, error } = await getSupabaseServer()
    .from("player_matches")
    .select("impact_category")
    .eq("puuid", puuid)
    .order("game_creation", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching recent impact categories:", error);
    return [];
  }

  return data.map((row) => row.impact_category as ImpactCategory);
}

export async function getMatchCacheEntry(matchId: string): Promise<{
  matchData: MatchDto | null;
  timelineData: MatchTimelineDto | null;
}> {
  const { data, error } = await getSupabaseServer()
    .from("match_cache")
    .select("match_data, timeline_data")
    .eq("match_id", matchId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching match_cache entry:", error);
  }

  return {
    matchData: (data?.match_data as MatchDto | undefined) ?? null,
    timelineData: (data?.timeline_data as MatchTimelineDto | undefined) ?? null,
  };
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

  const { data, error } = await getSupabaseServer()
    .from("match_details")
    .select("match_id, match_data")
    .in("match_id", matchIds);

  if (error) {
    console.error("Error fetching match details:", error);
    return matchMap;
  }

  for (const row of data) {
    matchMap.set(row.match_id, row.match_data as MatchDto);
  }
  return matchMap;
}

export async function getStoredMatchTimelines(
  matchIds: string[]
): Promise<Map<string, MatchTimelineDto>> {
  const timelineMap = new Map<string, MatchTimelineDto>();
  if (matchIds.length === 0) return timelineMap;

  const { data, error } = await getSupabaseServer()
    .from("match_timelines")
    .select("match_id, timeline_data")
    .in("match_id", matchIds);

  if (error) {
    console.error("Error fetching match timelines:", error);
    return timelineMap;
  }

  for (const row of data) {
    timelineMap.set(row.match_id, row.timeline_data as MatchTimelineDto);
  }
  return timelineMap;
}
