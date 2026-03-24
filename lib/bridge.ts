import type {
  AccountData,
  MatchSummary,
  PerformanceAnalysisResult,
} from "./types";

export type { AccountData, ChartDataPoint, MatchSummary, PerformanceAnalysisResult } from "./types";

const HEAD_SYNC_LOG = "[head-sync]";

export class BackendBridge {
  static async getAccount(
    gameName: string,
    tagLine: string
  ): Promise<AccountData | null> {
    try {
      const res = await fetch(
        `/api/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const message =
          (errBody as { error?: string }).error || `Failed to get account (${res.status})`;
        throw new Error(message);
      }
      const data = await res.json();
      if (data.error) {
        throw new Error((data as { error: string }).error);
      }
      return data as AccountData;
    } catch (error) {
      if (error instanceof Error) throw error;
      console.error("Error calling getAccount:", error);
      return null;
    }
  }

  static async getMatchHistory(
    puuid: string,
    count: number = 5,
    start: number = 0
  ): Promise<string[] | null> {
    try {
      const res = await fetch(
        `/api/match-history?puuid=${encodeURIComponent(puuid)}&count=${count}&start=${start}`
      );
      const url = `/api/match-history?count=${count}&start=${start}`;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `${HEAD_SYNC_LOG} getMatchHistory HTTP ${res.status} ${url}`,
          body.slice(0, 200)
        );
        return null;
      }
      const data = await res.json();
      if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) {
        console.warn(`${HEAD_SYNC_LOG} getMatchHistory API error`, (data as { error?: string }).error);
        return null;
      }
      if (!Array.isArray(data)) {
        console.warn(`${HEAD_SYNC_LOG} getMatchHistory unexpected shape`, typeof data);
        return null;
      }
      return data as string[];
    } catch (error) {
      console.error(`${HEAD_SYNC_LOG} getMatchHistory exception`, error);
      return null;
    }
  }

  static async analyzeMatchPerformance(
    matchId: string,
    userPuuid: string
  ): Promise<PerformanceAnalysisResult | null> {
    try {
      const res = await fetch(
        `/api/match-performance?matchId=${encodeURIComponent(matchId)}&userPuuid=${encodeURIComponent(userPuuid)}`
      );
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }
      const result = (await res.json()) as PerformanceAnalysisResult;
      if (result.success && result.playerMatchesPersistError) {
        return {
          success: false,
          error: result.playerMatchesPersistError,
          matchSummary: result.matchSummary,
        };
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: `Communication error: ${error}`,
      };
    }
  }

  static async getPlayerMatchData(
    gameName: string,
    tagLine: string,
    matchCount: number = 5
  ): Promise<MatchSummary[]> {
    const matches: MatchSummary[] = [];

    const account = await this.getAccount(gameName, tagLine);
    if (!account) {
      throw new Error("Failed to get account information");
    }

    const matchIds = await this.getMatchHistory(account.puuid, matchCount);
    if (!matchIds || matchIds.length === 0) {
      throw new Error("No match history found");
    }

    for (const matchId of matchIds) {
      const analysis = await this.analyzeMatchPerformance(
        matchId,
        account.puuid
      );
      if (analysis && analysis.success && analysis.matchSummary) {
        matches.push(analysis.matchSummary);
      }
    }

    return matches;
  }

  /**
   * Get paginated stored matches for a user from the database
   */
  static async getStoredMatches(
    puuid: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ matches: MatchSummary[]; totalCount: number; hasMore: boolean }> {
    try {
      const res = await fetch(
        `/api/stored-matches?puuid=${encodeURIComponent(puuid)}&limit=${limit}&offset=${offset}`
      );
      if (!res.ok) {
        console.error("Failed to get stored matches");
        return { matches: [], totalCount: 0, hasMore: false };
      }
      const data = await res.json();
      if (data.error) {
        console.error("Backend error:", data.error);
        return { matches: [], totalCount: 0, hasMore: false };
      }
      return {
        matches: data.matches || [],
        totalCount: data.totalCount || 0,
        hasMore: data.hasMore || false,
      };
    } catch (error) {
      console.error("Error calling getStoredMatches:", error);
      return { matches: [], totalCount: 0, hasMore: false };
    }
  }

  /**
   * Return which of the given match IDs already exist in player_matches for this puuid.
   */
  static async fetchExistingMatchIdsForPlayer(
    puuid: string,
    matchIds: string[]
  ): Promise<Set<string>> {
    if (matchIds.length === 0) return new Set();
    try {
      const res = await fetch("/api/player-matches/existing-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puuid, matchIds }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `${HEAD_SYNC_LOG} existing-ids HTTP ${res.status}`,
          body.slice(0, 200)
        );
        return new Set();
      }
      const data = (await res.json()) as { existingMatchIds?: string[]; error?: string };
      if (data.error) {
        console.warn(`${HEAD_SYNC_LOG} existing-ids error`, data.error);
        return new Set();
      }
      const set = new Set(data.existingMatchIds ?? []);
      console.info(
        `${HEAD_SYNC_LOG} existing-ids lookup puuid=${puuid.slice(0, 8)}… asked=${matchIds.length} foundInDb=${set.size}`
      );
      return set;
    } catch (e) {
      console.error(`${HEAD_SYNC_LOG} existing-ids exception`, e);
      return new Set();
    }
  }

  /**
   * Compare ranked Riot match list to DB; ingest new ids until one already in player_matches (anchor).
   * Fast path: if latest ranked match id is already stored, no work. For cold players (no rows),
   * returns immediately — use getPlayerMatchDataBatch from the dashboard.
   */
  static async syncNewHeadMatchesFromRiot(
    puuid: string,
    _dbNewestId: string | undefined,
    storedTotalCount: number,
    options: {
      windowSize?: number;
      analyzeDelayMs?: number;
      maxSyncRounds?: number;
    } = {}
  ): Promise<{
    analyzedCount: number;
    skippedAlreadyFresh: boolean;
    skippedNoHistory: boolean;
    /** Matches we attempted to analyze but did not persist successfully */
    failedAnalyzeAttempts: number;
  }> {
    const windowSize = options.windowSize ?? 25;
    const analyzeDelayMs = options.analyzeDelayMs ?? 1500;
    const maxSyncRounds = options.maxSyncRounds ?? 12;

    if (storedTotalCount === 0) {
      console.info(`${HEAD_SYNC_LOG} skip: no rows in player_matches for this user yet`);
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: false,
        skippedNoHistory: false,
        failedAnalyzeAttempts: 0,
      };
    }

    console.info(
      `${HEAD_SYNC_LOG} start puuid=${puuid.slice(0, 8)}… storedTotalCount=${storedTotalCount} window=${windowSize} maxRounds=${maxSyncRounds}`
    );

    const newestOnly = await this.getMatchHistory(puuid, 1, 0);
    if (!newestOnly || newestOnly.length === 0) {
      console.warn(`${HEAD_SYNC_LOG} abort: ranked match-history empty at start=0 (check Riot proxy / API key)`);
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: false,
        skippedNoHistory: true,
        failedAnalyzeAttempts: 0,
      };
    }

    const riotHeadId = newestOnly[0];
    const headExisting = await this.fetchExistingMatchIdsForPlayer(puuid, [riotHeadId]);
    if (headExisting.has(riotHeadId)) {
      console.info(
        `${HEAD_SYNC_LOG} fast path OK: latest ranked match already in DB (${riotHeadId.slice(0, 12)}…) — no ingest`
      );
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: true,
        skippedNoHistory: false,
        failedAnalyzeAttempts: 0,
      };
    }

    console.info(
      `${HEAD_SYNC_LOG} drift: ranked head ${riotHeadId.slice(0, 12)}… not in DB — ingesting until anchor`
    );

    let analyzedCount = 0;
    let failedAnalyzeAttempts = 0;
    let listOffset = 0;

    for (let round = 0; round < maxSyncRounds; round++) {
      const windowIds = await this.getMatchHistory(puuid, windowSize, listOffset);
      if (!windowIds || windowIds.length === 0) {
        if (round === 0) {
          console.warn(`${HEAD_SYNC_LOG} abort: empty window at offset 0 after non-empty single-id fetch`);
          return {
            analyzedCount: 0,
            skippedAlreadyFresh: false,
            skippedNoHistory: true,
            failedAnalyzeAttempts,
          };
        }
        console.info(`${HEAD_SYNC_LOG} round ${round} empty list at offset ${listOffset}, stop`);
        break;
      }

      const existing = await this.fetchExistingMatchIdsForPlayer(puuid, windowIds);
      const anchorIdx = windowIds.findIndex((id) => existing.has(id));
      const toAnalyze =
        anchorIdx === -1 ? windowIds : windowIds.slice(0, anchorIdx);

      console.info(
        `${HEAD_SYNC_LOG} round ${round} offset=${listOffset} ids=${windowIds.length} anchorIdx=${anchorIdx} toAnalyze=${toAnalyze.length}`
      );

      for (let i = 0; i < toAnalyze.length; i++) {
        const matchId = toAnalyze[i];
        const analysis = await this.analyzeMatchPerformance(matchId, puuid);
        if (analysis?.success && analysis.matchSummary) {
          analyzedCount++;
          console.info(
            `${HEAD_SYNC_LOG} analyze OK ${matchId.slice(0, 14)}… (${analyzedCount} ok so far)`
          );
        } else {
          failedAnalyzeAttempts++;
          console.warn(
            `${HEAD_SYNC_LOG} analyze FAIL ${matchId.slice(0, 14)}…`,
            analysis?.error ?? "no result"
          );
        }
        if (i < toAnalyze.length - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, analyzeDelayMs / Math.max(toAnalyze.length, 1))
          );
        }
      }

      if (anchorIdx !== -1) {
        console.info(`${HEAD_SYNC_LOG} anchored at idx ${anchorIdx}, done`);
        break;
      }
      if (windowIds.length < windowSize) {
        console.info(`${HEAD_SYNC_LOG} partial window (${windowIds.length}) end of ranked history for this depth`);
        break;
      }
      listOffset += windowIds.length;
    }

    console.info(
      `${HEAD_SYNC_LOG} end analyzedOk=${analyzedCount} analyzeFail=${failedAnalyzeAttempts} skippedNoHistory=false`
    );

    return {
      analyzedCount,
      skippedAlreadyFresh: false,
      skippedNoHistory: false,
      failedAnalyzeAttempts,
    };
  }

  /**
   * Lightweight check if Riot API has more matches beyond what's stored
   */
  static async checkApiHasMore(
    puuid: string,
    startFrom: number
  ): Promise<boolean> {
    try {
      const matchIds = await this.getMatchHistory(puuid, 1, startFrom);
      return matchIds !== null && matchIds.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get player match data in batches with pagination support
   * Returns matches and whether more matches are available
   * This is used when loading more matches from API
   */
  static async getPlayerMatchDataBatch(
    puuid: string,
    start: number = 0,
    batchSize: number = 5,
    delayBetweenBatches: number = 1500
  ): Promise<{ matches: MatchSummary[]; hasMore: boolean; nextStart: number }> {
    const matches: MatchSummary[] = [];

    // Fetch match IDs for this batch
    const matchIds = await this.getMatchHistory(puuid, batchSize, start);
    if (!matchIds || matchIds.length === 0) {
      return { matches: [], hasMore: false, nextStart: start };
    }

    // Process matches with a small delay between each to respect rate limits
    for (let i = 0; i < matchIds.length; i++) {
      const matchId = matchIds[i];
      
      const analysis = await this.analyzeMatchPerformance(matchId, puuid);
      if (analysis && analysis.success && analysis.matchSummary) {
        matches.push(analysis.matchSummary);
      }

      // Add delay between matches (except for the last one)
      if (i < matchIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches / matchIds.length));
      }
    }

    // If we got fewer matches than requested, there are no more
    const hasMore = matchIds.length === batchSize;
    const nextStart = start + matchIds.length;

    return { matches, hasMore, nextStart };
  }
}
