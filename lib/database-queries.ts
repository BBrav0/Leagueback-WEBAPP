import { supabase } from "./supabase";
import type { MatchDto, MatchTimelineDto, ImpactCategory } from "./types";

/**
 * Get all stored match IDs for a user from impact_categories table
 */
export async function getAllStoredMatchIds(puuid: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("impact_categories")
    .select("match_id")
    .eq("puuid", puuid)
    .order("match_id", { ascending: false });

  if (error) {
    console.error("Error fetching stored match IDs:", error);
    return [];
  }

  return data.map((row) => row.match_id);
}

/**
 * Get match details for multiple match IDs
 */
export async function getStoredMatchDetails(
  matchIds: string[]
): Promise<Map<string, MatchDto>> {
  const matchMap = new Map<string, MatchDto>();

  if (matchIds.length === 0) return matchMap;

  const { data, error } = await supabase
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

/**
 * Get match timelines for multiple match IDs
 */
export async function getStoredMatchTimelines(
  matchIds: string[]
): Promise<Map<string, MatchTimelineDto>> {
  const timelineMap = new Map<string, MatchTimelineDto>();

  if (matchIds.length === 0) return timelineMap;

  const { data, error } = await supabase
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

/**
 * Get all impact categories for a user (for lifetime stats)
 */
export async function getImpactCategoriesForUser(
  puuid: string
): Promise<ImpactCategory[]> {
  const { data, error } = await supabase
    .from("impact_categories")
    .select("category")
    .eq("puuid", puuid);

  if (error) {
    console.error("Error fetching impact categories:", error);
    return [];
  }

  return data.map((row) => row.category as ImpactCategory);
}

/**
 * Get paginated stored match IDs for a user
 */
export async function getPaginatedMatchIds(
  puuid: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ matchIds: string[]; totalCount: number }> {
  const { count: totalCount, error: countError } = await supabase
    .from("impact_categories")
    .select("*", { count: "exact", head: true })
    .eq("puuid", puuid);

  if (countError) {
    console.error("Error counting stored matches:", countError);
    return { matchIds: [], totalCount: 0 };
  }

  const { data, error } = await supabase
    .from("impact_categories")
    .select("match_id")
    .eq("puuid", puuid)
    .order("match_id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("Error fetching paginated match IDs:", error);
    return { matchIds: [], totalCount: totalCount || 0 };
  }

  return {
    matchIds: data.map((row) => row.match_id),
    totalCount: totalCount || 0,
  };
}

/**
 * Get impact categories for the last N matches (for pie chart)
 */
export async function getRecentImpactCategories(
  puuid: string,
  limit: number = 10
): Promise<ImpactCategory[]> {
  const { data, error } = await supabase
    .from("impact_categories")
    .select("category")
    .eq("puuid", puuid)
    .order("match_id", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching recent impact categories:", error);
    return [];
  }

  return data.map((row) => row.category as ImpactCategory);
}

/**
 * Get stored matches with their categories
 */
export async function getStoredMatchesWithCategories(
  puuid: string
): Promise<Array<{ matchId: string; category: ImpactCategory }>> {
  const { data, error } = await supabase
    .from("impact_categories")
    .select("match_id, category")
    .eq("puuid", puuid)
    .order("match_id", { ascending: false });

  if (error) {
    console.error("Error fetching stored matches with categories:", error);
    return [];
  }

  return data.map((row) => ({
    matchId: row.match_id,
    category: row.category as ImpactCategory,
  }));
}
