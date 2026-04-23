import type {
  AccountData,
  MatchDetailsResponse,
  MatchSummary,
  PerformanceAnalysisResult,
  StoredMatchesResult,
} from "./types";
import { getValidationFixtureMatchSummary, VALIDATION_FIXTURE_ACCOUNT } from "./validation-fixture";

const CURRENT_DERIVATION_VERSION = "match-summary-v2";

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
      if (res.status === 429) {
        // Server-side sync gate active — not an error, just gated.
        console.info("[sync-gate] Server rejected match-history request (sync gate active).");
        return null;
      }
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
      if (res.status === 429) {
        // Server-side sync gate active — surface as a gate response.
        return { success: false, error: "Sync gate active — Riot API is temporarily unavailable for this player." };
      }
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
  ): Promise<StoredMatchesResult> {
    try {
      const res = await fetch(
        `/api/stored-matches?puuid=${encodeURIComponent(puuid)}&limit=${limit}&offset=${offset}`
      );
      if (!res.ok) {
        console.error("Failed to get stored matches");
        const errorBody = await res.json().catch(() => ({}));
        return {
          matches: [],
          totalCount: 0,
          hasMore: false,
          readFailed: true,
          error:
            (errorBody as { error?: string }).error || `Failed to get stored matches (${res.status})`,
        };
      }
      const data = (await res.json()) as StoredMatchesResult;
      if (data.error) {
        console.error("Backend error:", data.error);
        return {
          matches: data.matches || [],
          totalCount: data.totalCount || 0,
          hasMore: data.hasMore || false,
          readFailed: data.readFailed ?? true,
          error: data.error,
        };
      }
      return {
        matches: data.matches || [],
        totalCount: data.totalCount || 0,
        hasMore: data.hasMore || false,
        readFailed: data.readFailed ?? false,
        error: data.error,
      };
    } catch (error) {
      console.error("Error calling getStoredMatches:", error);
      return {
        matches: [],
        totalCount: 0,
        hasMore: false,
        readFailed: true,
        error: error instanceof Error ? error.message : "Failed to read stored matches",
      };
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
      recentWindowSize: number;
      /** Delay between each match-performance call (rate limiting). */
      analyzeDelayMs?: number;
      maxSyncRounds?: number;
    }
  ): Promise<{
    analyzedCount: number;
    skippedAlreadyFresh: boolean;
    skippedNoHistory: boolean;
    syncMetadata?: {
      recentMatchWindow: number;
    };
    /** Matches we attempted to analyze but did not persist successfully */
    failedAnalyzeAttempts: number;
    refreshedStaleCount: number;
    failedStaleRefreshAttempts: number;
  }> {
    const recentWindowSize = Math.max(options.recentWindowSize, 1);
    const windowSize = Math.max(options.windowSize ?? recentWindowSize, recentWindowSize);
    const analyzeDelayMs = options.analyzeDelayMs ?? 1500;
    const maxSyncRounds = options.maxSyncRounds ?? 12;

    if (storedTotalCount === 0) {
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: false,
        skippedNoHistory: false,
        syncMetadata: undefined,
        failedAnalyzeAttempts: 0,
        refreshedStaleCount: 0,
        failedStaleRefreshAttempts: 0,
      };
    }

    const recentRiotMatchIds = await this.getMatchHistory(puuid, recentWindowSize, 0);
    if (!recentRiotMatchIds || recentRiotMatchIds.length === 0) {
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: false,
        skippedNoHistory: true,
        syncMetadata: undefined,
        failedAnalyzeAttempts: 0,
        refreshedStaleCount: 0,
        failedStaleRefreshAttempts: 0,
      };
    }

    const recentExisting = await this.fetchExistingMatchIdsForPlayer(puuid, recentRiotMatchIds);
    const missingRecentMatchIds = recentRiotMatchIds.filter((matchId) => !recentExisting.has(matchId));
    const staleRecentMatchIds =
      missingRecentMatchIds.length === 0
        ? await this.findStaleRecentMatchIds(puuid, recentRiotMatchIds)
        : [];

    let refreshedStaleCount = 0;
    let failedStaleRefreshAttempts = 0;

    if (missingRecentMatchIds.length === 0 && staleRecentMatchIds.length === 0) {
      return {
        analyzedCount: 0,
        skippedAlreadyFresh: true,
        skippedNoHistory: false,
        syncMetadata: undefined,
        failedAnalyzeAttempts: 0,
        refreshedStaleCount: 0,
        failedStaleRefreshAttempts: 0,
      };
    }

    let analyzedCount = 0;
    let failedAnalyzeAttempts = 0;
    let listOffset = recentRiotMatchIds.length;
    let syncMetadata: { recentMatchWindow: number } | undefined;

    for (let i = 0; i < missingRecentMatchIds.length; i++) {
      const matchId = missingRecentMatchIds[i];
      const analysis = await this.analyzeMatchPerformance(matchId, puuid);
      if (analysis?.success && analysis.matchSummary) {
        syncMetadata = analysis.syncMetadata ?? syncMetadata;
        analyzedCount++;
      } else {
        failedAnalyzeAttempts++;
      }
      if (i < missingRecentMatchIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, analyzeDelayMs));
      }
    }

    for (let i = 0; i < staleRecentMatchIds.length; i++) {
      const matchId = staleRecentMatchIds[i];
      const analysis = await this.analyzeMatchPerformance(matchId, puuid);
      if (analysis?.success && analysis.matchSummary) {
        syncMetadata = analysis.syncMetadata ?? syncMetadata;
        refreshedStaleCount++;
      } else {
        failedStaleRefreshAttempts++;
      }
      if (i < staleRecentMatchIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, analyzeDelayMs));
      }
    }

    for (let round = 0; round < maxSyncRounds; round++) {
      const windowIds = await this.getMatchHistory(puuid, windowSize, listOffset);
      if (!windowIds || windowIds.length === 0) {
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
          syncMetadata = analysis.syncMetadata ?? syncMetadata;
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
      syncMetadata,
      failedAnalyzeAttempts,
      refreshedStaleCount,
      failedStaleRefreshAttempts,
    };
  }

  private static async findStaleRecentMatchIds(
    puuid: string,
    recentRiotMatchIds: string[]
  ): Promise<string[]> {
    try {
      const staleEndpoint =
        typeof window === "undefined"
          ? "http://127.0.0.1/api/player-matches/stale-ids"
          : "/api/player-matches/stale-ids";
      const actualRes = await fetch(staleEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          puuid,
          matchIds: recentRiotMatchIds,
          derivationVersion: CURRENT_DERIVATION_VERSION,
        }),
      });

      if (!actualRes.ok) {
        console.error("findStaleRecentMatchIds HTTP", actualRes.status);
        return [];
      }

      const data = (await actualRes.json()) as { staleMatchIds?: string[]; error?: string };
      if (data.error) {
        console.error("findStaleRecentMatchIds:", data.error);
        return [];
      }

      return data.staleMatchIds ?? [];
    } catch (error) {
      console.error("findStaleRecentMatchIds:", error);
      return [];
    }
  }

  /**
   * Get the last sync timestamp for a player.
   */
  static async getSyncStatus(
    puuid: string
  ): Promise<{ lastSyncAt: string | null }> {
    try {
      const res = await fetch(
        `/api/player-sync-status?puuid=${encodeURIComponent(puuid)}`
      );
      if (!res.ok) {
        console.error("Failed to get sync status", res.status);
        return { lastSyncAt: null };
      }
      const data = (await res.json()) as { lastSyncAt?: string | null; error?: string };
      if (data.error) {
        console.error("Backend error:", data.error);
        return { lastSyncAt: null };
      }
      return { lastSyncAt: data.lastSyncAt ?? null };
    } catch (error) {
      console.error("Error calling getSyncStatus:", error);
      return { lastSyncAt: null };
    }
  }

  /**
   * Record that a Riot sync was attempted for a player (updates last_riot_sync_at).
   */
  static async updateSyncTimestamp(
    puuid: string
  ): Promise<{ success: boolean; lastSyncAt: string | null }> {
    try {
      const res = await fetch("/api/player-sync-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puuid }),
      });
      if (!res.ok) {
        console.error("Failed to update sync timestamp", res.status);
        return { success: false, lastSyncAt: null };
      }
      const data = (await res.json()) as { success?: boolean; lastSyncAt?: string | null; error?: string };
      if (data.error) {
        console.error("Backend error:", data.error);
        return { success: false, lastSyncAt: null };
      }
      return { success: true, lastSyncAt: data.lastSyncAt ?? null };
    } catch (error) {
      console.error("Error calling updateSyncTimestamp:", error);
      return { success: false, lastSyncAt: null };
    }
  }

  /**
   * Lightweight check if Riot API has more matches beyond what's stored.
   * Returns true if more matches exist, false if genuinely no more, or null
   * if the request was blocked by the sync gate (429).
   */
  static async checkApiHasMoreWithGateStatus(
    puuid: string,
    startFrom: number
  ): Promise<boolean | null> {
    try {
      const matchIds = await this.getMatchHistory(puuid, 1, startFrom);
      // getMatchHistory returns null on 429 (sync gate active)
      if (matchIds === null) return null;
      return matchIds.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Lightweight check if Riot API has more matches beyond what's stored.
   * Returns true if more matches exist, false otherwise (including sync gate blocks).
   */
  static async checkApiHasMore(
    puuid: string,
    startFrom: number
  ): Promise<boolean> {
    const result = await this.checkApiHasMoreWithGateStatus(puuid, startFrom);
    return result === true;
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
