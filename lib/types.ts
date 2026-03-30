// ===== Riot API Response Types =====

export interface AccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
}

// Alias used by bridge.ts / frontend
export type AccountData = AccountDto;

export interface MatchDto {
  info: MatchInfo;
}

export interface MatchInfo {
  participants: Participant[];
  teams: Team[];
  gameDuration: number;
  gameCreation: number;
}

export interface Participant {
  summonerName: string;
  championName: string;
  visionScore: number;
  kills: number;
  deaths: number;
  assists: number;
  totalDamageDealtToChampions: number;
  teamId: number;
  puuid: string;
  participantId: number;
  teamPosition: string;
}

export interface Team {
  teamId: number;
  win: boolean;
}

export interface MatchTimelineDto {
  info: TimelineInfoDto;
}

export interface TimelineInfoDto {
  frames: TimelineFrameDto[];
}

export interface TimelineFrameDto {
  participantFrames: Record<string, TimelineParticipantFrameDto>;
  events: TimelineEventDto[];
  timestamp: number;
}

export interface TimelineParticipantFrameDto {
  participantId: number;
  totalGold: number;
  minionsKilled: number;
  jungleMinionsKilled: number;
  level: number;
  damageStats: DamageStatsDto;
}

export interface DamageStatsDto {
  totalDamageDoneToChampions: number;
}

export interface TimelineEventDto {
  type: string;
  killerId: number;
  victimId: number;
  assistingParticipantIds: number[];
}

// ===== Frontend Types =====

export interface ChartDataPoint {
  minute: number;
  yourImpact: number;
  teamImpact: number;
}

export interface MatchSummary {
  id: string;
  summonerName: string;
  champion: string;
  rank: string | null;
  rankLabel: string;
  kda: string;
  cs: number;
  visionScore: number;
  gameResult: "Victory" | "Defeat";
  gameTime: string;
  playedAt: string;
  durationSeconds: number;
  role: string | null;
  roleLabel: string;
  damageToChampions: number | null;
  damageToChampionsLabel: string;
  impactCategory: ImpactCategory;
  impactCategoryLabel: string;
  data: ChartDataPoint[];
  yourImpact: number;
  teamImpact: number;
}

export interface MatchDetailsTeamSummary {
  teamId: number;
  result: "Victory" | "Defeat" | "Unknown";
  resultLabel: string;
}

export interface MatchDetailsParticipantSummary {
  participantId: number;
  puuid: string;
  summonerName: string;
  championName: string;
  teamId: number;
  role: string | null;
  roleLabel: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  kdaLabel: string;
  visionScore: number | null;
  visionScoreLabel: string;
  damageToChampions: number | null;
  damageToChampionsLabel: string;
  isCurrentPlayer: boolean;
  isMissingCoreData: boolean;
}

export interface MatchDetailsData {
  matchId: string;
  status: "ready" | "partial" | "unavailable";
  statusLabel: string;
  fallbackReason: "none" | "partial_raw_data" | "missing_raw_data";
  source: "match_cache" | "legacy_cache" | "none";
  teams: MatchDetailsTeamSummary[];
  participants: MatchDetailsParticipantSummary[];
}

export interface MatchDetailsResponse {
  details: MatchDetailsData;
}

export interface PerformanceAnalysisResult {
  success: boolean;
  matchSummary?: MatchSummary;
  error?: string;
  syncMetadata?: {
    recentMatchWindow: number;
  };
  /** Present when player_matches upsert failed. */
  playerMatchesPersistError?: string;
  /** Present when match_cache upsert failed. */
  matchCachePersistError?: string;
  /** Present when sync metadata persistence failed. */
  syncMetadataPersistError?: string;
}

export type ImpactCategory =
  | "impactWins"
  | "impactLosses"
  | "guaranteedWins"
  | "guaranteedLosses";
