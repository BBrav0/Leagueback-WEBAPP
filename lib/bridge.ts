import type {
  AccountData,
  MatchDetailsResponse,
  MatchSummary,
  PerformanceAnalysisResult,
} from "./types";
import { getValidationFixtureMatchSummary, VALIDATION_FIXTURE_ACCOUNT } from "./validation-fixture";

export type {
  AccountData,
  ChartDataPoint,
  MatchDetailsData,
  MatchDetailsParticipantSummary,
  MatchDetailsResponse,
  MatchDetailsTeamSummary,
  MatchSummary,
  PerformanceAnalysisResult,
} from "./types";

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
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data)) {
        if (data?.error) console.error("Backend error:", data.error);
        return null;
      }
      return data as string[];
    } catch (error) {
      console.error("Error calling getMatchHistory:", error);
      return null;
    }
  }

  static async analyzeMatchPerformance(
    matchId: string,
    userPuuid: string
  ): Promise<PerformanceAnalysisResult | null> {
    if (userPuuid === VALIDATION_FIXTURE_ACCOUNT.puuid) {
      const matchSummary = getValidationFixtureMatchSummary(matchId);
      if (!matchSummary) {
        return {
          success: false,
          error: `Fixture match ${matchId} is unavailable.`,
        };
      }

      return {
        success: true,
        matchSummary,
      };
    }

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

  static async getMatchDetails(
    matchId: string,
    userPuuid: string
  ): Promise<MatchDetailsResponse | null> {
    try {
      const res = await fetch(
        `/api/match-details?matchId=${encodeURIComponent(matchId)}&userPuuid=${encodeURIComponent(userPuuid)}`
      );

      if (!res.ok) {
        console.error("Failed to get match details", res.status);
        return null;
      }

      const data = (await res.json()) as MatchDetailsResponse & { error?: string };
      if (data.error) {
        console.error("Backend error:", data.error);
        return null;
      }

      return data;
    } catch (error) {
      console.error("Error calling getMatchDetails:", error);
      return null;
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
        console.error("fetchExistingMatchIdsForPlayer HTTP", res.status);
        return new Set();
      }
      const data = (await res.json()) as { existingMatchIds?: string[]; error?: string };
      if (data.error) {
        console.error("fetchExistingMatchIdsForPlayer:", data.error);
        return new Set();
      }
      return new Set(data.existingMatchIds ?? []);
    } catch (e) {
      console.error("fetchExistingMatchIdsForPlayer:", e);
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
    storedTotalCount: number,
    options: {
      windowSize?: number;
      /** Delay between each match-performance call (rate limiting). */
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
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: false,
        skippedNoHistory: false,
        failedAnalyzeAttempts: 0,
      };
    }

    const newestOnly = await this.getMatchHistory(puuid, 1, 0);
    if (!newestOnly || newestOnly.length === 0) {
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
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: true,
        skippedNoHistory: false,
        failedAnalyzeAttempts: 0,
      };
    }

    let analyzedCount = 0;
    let failedAnalyzeAttempts = 0;
    let listOffset = 0;

    for (let round = 0; round < maxSyncRounds; round++) {
      const windowIds = await this.getMatchHistory(puuid, windowSize, listOffset);
      if (!windowIds || windowIds.length === 0) {
        if (round === 0) {
          return {
            analyzedCount: 0,
            skippedAlreadyFresh: false,
            skippedNoHistory: true,
            failedAnalyzeAttempts,
          };
        }
        break;
      }

      const existing = await this.fetchExistingMatchIdsForPlayer(puuid, windowIds);
      const anchorIdx = windowIds.findIndex((id) => existing.has(id));
      const toAnalyze =
        anchorIdx === -1 ? windowIds : windowIds.slice(0, anchorIdx);

      for (let i = 0; i < toAnalyze.length; i++) {
        const matchId = toAnalyze[i];
        const analysis = await this.analyzeMatchPerformance(matchId, puuid);
        if (analysis?.success && analysis.matchSummary) {
          analyzedCount++;
        } else {
          failedAnalyzeAttempts++;
        }
        if (i < toAnalyze.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, analyzeDelayMs));
        }
      }

      if (anchorIdx !== -1) {
        break;
      }
      if (windowIds.length < windowSize) {
        break;
      }
      listOffset += windowIds.length;
    }

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
    /** Delay between each match-performance request (rate limiting). */
    delayBetweenMatchesMs: number = 1500
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

      if (i < matchIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenMatchesMs));
      }
    }

    // If we got fewer matches than requested, there are no more
    const hasMore = matchIds.length === batchSize;
    const nextStart = start + matchIds.length;

    return { matches, hasMore, nextStart };
  }
}
