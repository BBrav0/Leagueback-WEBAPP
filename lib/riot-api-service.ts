import { supabase } from "./supabase";
import type { AccountDto, MatchDto, MatchTimelineDto } from "./types";

const WORKER_URL =
  process.env.RIOT_PROXY_URL ?? "https://riot-proxy.riot-proxy.workers.dev";

export async function getAccountByRiotId(
  gameName: string,
  tagLine: string
): Promise<AccountDto> {
  // Check Supabase cache (case-insensitive — Riot names are case-insensitive)
  const { data: cached } = await supabase
    .from("accounts")
    .select("puuid, game_name, tag_line")
    .ilike("game_name", gameName)
    .ilike("tag_line", tagLine)
    .single();

  if (cached) {
    return {
      puuid: cached.puuid,
      gameName: cached.game_name,
      tagLine: cached.tag_line,
    };
  }

  // Fetch from worker
  const res = await fetch(
    `${WORKER_URL}/api/account/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  if (!res.ok) {
    throw new Error(
      `Failed to get account. Status: ${res.status}`
    );
  }

  const account: AccountDto = await res.json();

  // Cache in Supabase — must await on Vercel serverless
  await supabase
    .from("accounts")
    .upsert({
      puuid: account.puuid,
      game_name: account.gameName,
      tag_line: account.tagLine,
    });

  return account;
}

export async function getMatchHistory(
  puuid: string,
  count: number = 10,
  start: number = 0
): Promise<string[]> {
  // Always fetch fresh — new matches may have appeared
  const res = await fetch(
    `${WORKER_URL}/api/matches/${encodeURIComponent(puuid)}?type=ranked&count=${count}&start=${start}`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match history. Status: ${res.status}`);
  }
  return res.json();
}

export async function getMatchDetails(
  matchId: string
): Promise<MatchDto> {
  // Check Supabase cache
  const { data: cached } = await supabase
    .from("match_details")
    .select("match_data")
    .eq("match_id", matchId)
    .single();

  if (cached) {
    return cached.match_data as MatchDto;
  }

  // Fetch from worker
  const res = await fetch(
    `${WORKER_URL}/api/match/${encodeURIComponent(matchId)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match details. Status: ${res.status}`);
  }

  const matchDto: MatchDto = await res.json();

  // Cache in Supabase — must await on Vercel serverless
  await supabase
    .from("match_details")
    .upsert({ match_id: matchId, match_data: matchDto });

  return matchDto;
}

export async function getMatchTimeline(
  matchId: string
): Promise<MatchTimelineDto> {
  // Check Supabase cache
  const { data: cached } = await supabase
    .from("match_timelines")
    .select("timeline_data")
    .eq("match_id", matchId)
    .single();

  if (cached) {
    return cached.timeline_data as MatchTimelineDto;
  }

  // Fetch from worker
  const res = await fetch(
    `${WORKER_URL}/api/match/${encodeURIComponent(matchId)}/timeline`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match timeline. Status: ${res.status}`);
  }

  const timelineDto: MatchTimelineDto = await res.json();

  // Cache in Supabase — must await on Vercel serverless
  await supabase
    .from("match_timelines")
    .upsert({ match_id: matchId, timeline_data: timelineDto });

  return timelineDto;
}
