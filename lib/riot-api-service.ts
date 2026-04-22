import { getSql } from "./neon";
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
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT summoner_id FROM accounts WHERE puuid = ${puuid}
    `;
    const row = rows as [{ summoner_id: string | null }];
    return row[0]?.summoner_id?.trim() || undefined;
  } catch (error) {
    console.error("accounts summoner_id lookup failed:", error);
    return undefined;
  }
}

async function cacheSummonerIdForPuuid(
  puuid: string,
  summonerId: string,
  fallbackAccount?: Pick<AccountDto, "gameName" | "tagLine">
): Promise<void> {
  try {
    const sql = getSql();

    let gameName: string | null;
    let tagLine: string | null;

    if (fallbackAccount) {
      gameName = fallbackAccount.gameName;
      tagLine = fallbackAccount.tagLine;
    } else {
      const rows = await sql`
        SELECT game_name, tag_line FROM accounts WHERE puuid = ${puuid}
      `;
      const existing = (rows as [{ game_name: string | null; tag_line: string | null }])[0];
      gameName = existing?.game_name ?? null;
      tagLine = existing?.tag_line ?? null;
    }

    await sql`
      INSERT INTO accounts (puuid, game_name, tag_line, summoner_id)
      VALUES (${puuid}, ${gameName}, ${tagLine}, ${summonerId})
      ON CONFLICT (puuid) DO UPDATE SET
        game_name = COALESCE(EXCLUDED.game_name, accounts.game_name),
        tag_line = COALESCE(EXCLUDED.tag_line, accounts.tag_line),
        summoner_id = EXCLUDED.summoner_id
    `;
  } catch (error) {
    console.error("accounts summoner_id cache upsert failed:", error);
  }
}

async function getCachedSummonerIdFromMatchParticipants(
  puuid: string
): Promise<string | undefined> {
  try {
    const sql = getSql();

    const playerMatchRows = await sql`
      SELECT match_id FROM player_matches
      WHERE puuid = ${puuid}
      ORDER BY created_at DESC
      LIMIT 25
    `;

    const matchIds = Array.from(
      new Set(
        ((playerMatchRows as { match_id: string }[]))
          .map((row) => row.match_id?.trim())
          .filter((matchId): matchId is string => Boolean(matchId))
      )
    );

    if (matchIds.length === 0) {
      return undefined;
    }

    const cacheRows = await sql`
      SELECT match_id, match_data FROM match_cache
      WHERE match_id = ANY(${matchIds})
    `;

    for (const row of cacheRows as [{ match_id: string; match_data: MatchDto }]) {
      const participants = row.match_data?.info?.participants;
      const participant = participants?.find((entry) => entry.puuid === puuid);
      const summonerId = participant?.summonerId?.trim();

      if (summonerId) {
        await cacheSummonerIdForPuuid(puuid, summonerId);
        return summonerId;
      }
    }

    return undefined;
  } catch (error) {
    console.error("match participant summonerId lookup failed:", error);
    return undefined;
  }
}

export async function getAccountByRiotId(
  gameName: string,
  tagLine: string
): Promise<AccountDto> {
  // Check Neon cache (case-insensitive — Riot names are case-insensitive)
  try {
    const sql = getSql();
    const cachedRows = await sql`
      SELECT puuid, game_name, tag_line, summoner_id FROM accounts
      WHERE game_name ILIKE ${gameName} AND tag_line ILIKE ${tagLine}
    `;
    const cached = (cachedRows as [{ puuid: string; game_name: string; tag_line: string; summoner_id: string | null }])[0];

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
  } catch (error) {
    console.error("accounts cache lookup failed:", error);
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

  // Cache in Neon — must await on Vercel serverless
  try {
    const sql = getSql();
    await sql`
      INSERT INTO accounts (puuid, game_name, tag_line, summoner_id)
      VALUES (${account.puuid}, ${account.gameName}, ${account.tagLine}, ${account.summonerId ?? null})
      ON CONFLICT (puuid) DO UPDATE SET
        game_name = EXCLUDED.game_name,
        tag_line = EXCLUDED.tag_line,
        summoner_id = COALESCE(EXCLUDED.summoner_id, accounts.summoner_id)
    `;
  } catch (error) {
    console.error("accounts cache upsert failed:", error);
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
  // Check Neon cache
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT match_data FROM match_details WHERE match_id = ${matchId}
    `;
    const cached = (rows as [{ match_data: MatchDto }])[0];

    if (cached) {
      return cached.match_data;
    }
  } catch (error) {
    console.error("match_details cache lookup failed:", error);
  }

  // Fetch from Riot API
  const res = await riotFetch(
    `/lol/match/v5/matches/${encodeURIComponent(matchId)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match details. Status: ${res.status}`);
  }

  const matchDto: MatchDto = await res.json();

  // Cache in Neon — must await on Vercel serverless
  try {
    const sql = getSql();
    await sql`
      INSERT INTO match_details (match_id, match_data)
      VALUES (${matchId}, ${JSON.stringify(matchDto)}::jsonb)
      ON CONFLICT (match_id) DO UPDATE SET
        match_data = EXCLUDED.match_data
    `;
  } catch (error) {
    console.error("match_details cache upsert failed:", error);
  }

  return matchDto;
}

export async function getMatchTimeline(
  matchId: string
): Promise<MatchTimelineDto> {
  // Check Neon cache
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT timeline_data FROM match_timelines WHERE match_id = ${matchId}
    `;
    const cached = (rows as [{ timeline_data: MatchTimelineDto }])[0];

    if (cached) {
      return cached.timeline_data;
    }
  } catch (error) {
    console.error("match_timelines cache lookup failed:", error);
  }

  // Fetch from Riot API
  const res = await riotFetch(
    `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`
  );
  if (!res.ok) {
    throw new Error(`Failed to get match timeline. Status: ${res.status}`);
  }

  const timelineDto: MatchTimelineDto = await res.json();

  // Cache in Neon — must await on Vercel serverless
  try {
    const sql = getSql();
    await sql`
      INSERT INTO match_timelines (match_id, timeline_data)
      VALUES (${matchId}, ${JSON.stringify(timelineDto)}::jsonb)
      ON CONFLICT (match_id) DO UPDATE SET
        timeline_data = EXCLUDED.timeline_data
    `;
  } catch (error) {
    console.error("match_timelines cache upsert failed:", error);
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
