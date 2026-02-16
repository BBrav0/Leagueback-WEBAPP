import type {
  AccountData,
  MatchSummary,
  PerformanceAnalysisResult,
} from "./types";

export type { AccountData, ChartDataPoint, MatchSummary, PerformanceAnalysisResult } from "./types";

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
        console.error("Failed to get account:", res.status, errBody.error || "");
        return null;
      }
      const data = await res.json();
      if (data.error) {
        console.error("Backend error:", data.error);
        return null;
      }
      return data as AccountData;
    } catch (error) {
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
      if (data.error) {
        console.error("Backend error:", data.error);
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
    try {
      const res = await fetch(
        `/api/match-performance?matchId=${encodeURIComponent(matchId)}&userPuuid=${encodeURIComponent(userPuuid)}`
      );
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }
      return (await res.json()) as PerformanceAnalysisResult;
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
