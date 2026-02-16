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
        console.error("Failed to get account");
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
    count: number = 5
  ): Promise<string[] | null> {
    try {
      const res = await fetch(
        `/api/match-history?puuid=${encodeURIComponent(puuid)}&count=${count}`
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
}
