import { getSupabaseServer } from "./supabase-server";
import type { AccountDto, MatchDto, MatchTimelineDto } from "./types";
import type { LeagueEntryDto } from "./rank-snapshot";

/* ── Riot API constants ─────────────────────────────────────────────── */

const ACCOUNT_REGION_BASE = "https://americas.api.riotgames.com";
const PLATFORM_REGION_BASE = "https://na1.api.riotgames.com";

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Read at call-time (not module-load) for Cloudflare Worker compatibility. */
function getRiotApiKey(): string {
  const key = process.env.RIOT_API_KEY;
  if (!key) {
    throw new Error("RIOT_API_KEY is not configured");
  }
  return key;
}

/**
 * Fetch from the Riot API directly, attaching the API key header.
 * `path` must start with `/` (e.g. `/riot/account/v1/...`).
 */
async function riotFetch(
  path: string,
  baseUrl: string = ACCOUNT_REGION_BASE
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: { "X-Riot-Token": getRiotApiKey() },
  });
}

async function getCachedSummonerIdByPuuid(
  puuid: string
): Promise<string | undefined> {
  const { data, error } = await getSupabaseServer()
    .from("accounts")
    .select("summoner_id")
    .eq("puuid", puuid)
    .maybeSingle();

  if (error) {
    console.error("accounts summoner_id lookup failed:", error.message);
    return undefined;
  }

  return data?.summoner_id?.trim() || undefined;
}

async function cacheSummonerIdForPuuid(
  puuid: string,
  summonerId: string,
  fallbackAccount?: Pick<AccountDto, "gameName" | "tagLine">
): Promise<void> {
  const existingAccount = fallbackAccount
    ? null
    : await getSupabaseServer()
        .from("accounts")
        .select("game_name, tag_line")
        .eq("puuid", puuid)
        .maybeSingle();

  const gameName =
    fallbackAccount?.gameName ?? existingAccount?.data?.game_name ?? null;
  const tagLine =
    fallbackAccount?.tagLine ?? existingAccount?.data?.tag_line ?? null;

  const { error } = await getSupabaseServer()
    .from("accounts")
    .upsert(
      { puuid, game_name: gameName, tag_line: tagLine, summoner_id: summonerId },
      { onConflict: "puuid" }
    );

  if (error) {
    console.error("accounts summoner_id cache upsert failed:", error.message);
  }
}

async function getCachedSummonerIdFromMatchParticipants(
  puuid: string
): Promise<string | undefined> {
  const { data: playerMatches, error: playerMatchesError } = await getSupabaseServer()
    .from("player_matches")
    .select("match_id")
    .eq("puuid", puuid)
    .order("created_at", { ascending: false })
    .limit(25);

  if (playerMatchesError) {
    console.error(
      "player_matches summonerId candidate lookup failed:",
      playerMatchesError.message
    );
    return undefined;
  }

  const matchIds = Array.from(
    new Set(
      (playerMatches ?? [])
        .map((row) => row.match_id?.trim())
        .filter((matchId): matchId is string => Boolean(matchId))
    )
  );

  if (matchIds.length === 0) {
    return undefined;
  }

  const { data, error } = await getSupabaseServer()
    .from("match_cache")
    .select("match_id, match_data")
    .in("match_id", matchIds);

  if (error) {
    console.error("match_cache summonerId lookup failed:", error.message);
    return undefined;
  }

  for (const row of data ?? []) {
    const participants = (row.match_data as MatchDto | undefined)?.info?.participants;
    const participant = participants?.find((entry) => entry.puuid === puuid);
    const summonerId = participant?.summonerId?.trim();

    if (summonerId) {
      await cacheSummonerIdForPuuid(puuid, summonerId);
      return summonerId;
    }
  }

  return undefined;
}

export async function getAccountByRiotId(
  gameName: string,
  tagLine: string
): Promise<AccountDto> {
  // Check Supabase cache (case-insensitive — Riot names are case-insensitive)
  const { data: cached } = await getSupabaseServer()
    .from("accounts")
    .select("puuid, game_name, tag_line, summoner_id")
    .ilike("game_name", gameName)
    .ilike("tag_line", tagLine)
    .single();

  if (cached) {
    return {
      puuid: cached.puuid,
      gameName: cached.game_name,
      tagLine: cached.tag_line,
      summonerId: cached.summoner_id ?? undefined,
      riotId: `${cached.game_name}#${cached.tag_line}`,
      rankLookupId: cached.summoner_id ?? cached.puuid,
    };
  }

  // Fetch from Riot API
  const res = await riotFetch(
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  if (!res.ok) {
    const bodyText = await res.text();
    let message: string;
    if (res.status === 404) {
      try {
        const body = JSON.parse(bodyText) as { status?: { message?: string } };
        message =
          body?.status?.message?.trim() || "Account not found";
      } catch {
        message = "Account not found";
      }
      throw new Error(message);
    }
    if (res.status === 429) {
      throw new Error("Rate limit exceeded. Try again later.");
    }
    message = `Failed to get account. Status: ${res.status}`;
    if (bodyText) {
      try {
        const body = JSON.parse(bodyText) as { status?: { message?: string }; error?: string };
        const detail = body?.status?.message ?? body?.error;
        if (detail) message += ` — ${detail}`;
      } catch {
        // keep message as-is
      }
    }
    throw new Error(message);
  }

  const account: AccountDto = await res.json();
  account.riotId = `${account.gameName}#${account.tagLine}`;

  if (!account.summonerId) {
    account.summonerId = await getSummonerIdByPuuid(account.puuid);
    if (account.summonerId) {
      await cacheSummonerIdForPuuid(account.puuid, account.summonerId, account);
    }
  }

  account.rankLookupId = account.summonerId ?? account.puuid;

  // Cache in Supabase — must await on Vercel serverless
  const { error: accountCacheError } = await getSupabaseServer()
    .from("accounts")
    .upsert({
      puuid: account.puuid,
      game_name: account.gameName,
      tag_line: account.tagLine,
      summoner_id: account.summonerId ?? null,
    });
  if (accountCacheError) {
    console.error("accounts cache upsert failed:", accountCacheError.message);
  }

  return account;
}

export async function getSummonerIdByPuuid(
  puuid: string
): Promise<string | undefined> {
  const cachedSummonerId = await getCachedSummonerIdByPuuid(puuid);
  if (cachedSummonerId) {
    return cachedSummonerId;
  }

  const res = await riotFetch(
    `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
    PLATFORM_REGION_BASE
  );

  if (!res.ok) {
    if (res.status === 404) {
      return getCachedSummonerIdFromMatchParticipants(puuid);
    }

    if (res.status === 403) {
      const fallbackSummonerId = await getCachedSummonerIdFromMatchParticipants(puuid);
      if (fallbackSummonerId) {
        return fallbackSummonerId;
      }
    }

    throw new Error(`Failed to get summoner data. Status: ${res.status}`);
  }

  const data = (await res.json()) as { id?: string };
  const summonerId = data.id?.trim();
  if (summonerId) {
    await cacheSummonerIdForPuuid(puuid, summonerId);
    return summonerId;
  }

  return getCachedSummonerIdFromMatchParticipants(puuid);
}

export async function getMatchHistory(
  puuid: string,
  count: number = 10,
  start: number = 0
): Promise<string[]> {
  // Always fetch fresh — new matches may have appeared
  const path = `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?type=ranked&start=${start}&count=${count}`;
  const requestUrl = `${ACCOUNT_REGION_BASE}${path}`;
  const res = await riotFetch(path);
  if (!res.ok) {
    const bodyText = await res.text();
    let detail = "";
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as {
          error?: string;
          status?: { message?: string; status_code?: number };
        };
        detail = parsed.error ?? parsed.status?.message ?? bodyText;
      } catch {
        detail = bodyText;
      }
    }

    console.error("Failed to get match history from Riot API", {
      status: res.status,
      requestUrl,
      puuid,
      start,
      count,
      detail,
    });

    throw new Error(
      detail
        ? `Failed to get match history. Status: ${res.status} — ${detail}`
        : `Failed to get match history. Status: ${res.status}`
    );
  }
  return res.json();
}

export async function getMatchDetails(
  matchId: string
): Promise<MatchDto> {
  // Check Supabase cache
  const { data: cached } = await getSupabaseServer()
    .from("match_details")
    .select("match_data")
    .eq("match_id", matchId)
    .single();

  if (cached) {
    return cached.match_data as MatchDto;
  }

  // Fetch from Riot API
  const res = await riotFetch(
    `/lol/match/v5/matches/${encodeURIComponent(matchId)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match details. Status: ${res.status}`);
  }

  const matchDto: MatchDto = await res.json();

  // Cache in Supabase — must await on Vercel serverless
  const { error: detailsCacheError } = await getSupabaseServer()
    .from("match_details")
    .upsert({ match_id: matchId, match_data: matchDto });
  if (detailsCacheError) {
    console.error("match_details cache upsert failed:", detailsCacheError.message);
  }

  return matchDto;
}

export async function getMatchTimeline(
  matchId: string
): Promise<MatchTimelineDto> {
  // Check Supabase cache
  const { data: cached } = await getSupabaseServer()
    .from("match_timelines")
    .select("timeline_data")
    .eq("match_id", matchId)
    .single();

  if (cached) {
    return cached.timeline_data as MatchTimelineDto;
  }

  // Fetch from Riot API
  const res = await riotFetch(
    `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match timeline. Status: ${res.status}`);
  }

  const timelineDto: MatchTimelineDto = await res.json();

  // Cache in Supabase — must await on Vercel serverless
  const { error: timelineCacheError } = await getSupabaseServer()
    .from("match_timelines")
    .upsert({ match_id: matchId, timeline_data: timelineDto });
  if (timelineCacheError) {
    console.error("match_timelines cache upsert failed:", timelineCacheError.message);
  }

  return timelineDto;
}

export async function getCurrentRankEntries(
  summonerId: string
): Promise<LeagueEntryDto[]> {
  // Try by-summoner first, fall back to by-puuid on 403
  const res = await riotFetch(
    `/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`,
    PLATFORM_REGION_BASE
  );

  if (res.status === 403) {
    const fallbackRes = await riotFetch(
      `/lol/league-exp/v4/entries/by-puuid/${encodeURIComponent(summonerId)}`,
      PLATFORM_REGION_BASE
    );

    if (!fallbackRes.ok) {
      if (fallbackRes.status === 404 || fallbackRes.status === 403) {
        return [];
      }
      throw new Error(`Failed to get current rank data. Status: ${fallbackRes.status}`);
    }

    const data = (await fallbackRes.json()) as LeagueEntryDto[];
    return Array.isArray(data) ? data : [];
  }

  if (!res.ok) {
    if (res.status === 404) {
      return [];
    }
    throw new Error(`Failed to get current rank data. Status: ${res.status}`);
  }

  const data = (await res.json()) as LeagueEntryDto[];
  return Array.isArray(data) ? data : [];
}

