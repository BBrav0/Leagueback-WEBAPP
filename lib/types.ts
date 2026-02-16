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
  rank: string;
  kda: string;
  cs: number;
  visionScore: number;
  gameResult: "Victory" | "Defeat";
  gameTime: string;
  data: ChartDataPoint[];
  yourImpact: number;
  teamImpact: number;
}

export interface PerformanceAnalysisResult {
  success: boolean;
  matchSummary?: MatchSummary;
  error?: string;
}

export type ImpactCategory =
  | "impactWins"
  | "impactLosses"
  | "guaranteedWins"
  | "guaranteedLosses";
