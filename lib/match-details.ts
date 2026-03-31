import {
  buildMatchMetadata,
} from "./match-reconstruction";
import type {
  MatchDetailsData,
  MatchDetailsParticipantSummary,
  MatchDetailsTeamSummary,
  MatchDto,
} from "./types";

function formatOptionalStat(value: number | undefined, unavailableLabel: string): {
  value: number | null;
  label: string;
} {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return {
      value: null,
      label: unavailableLabel,
    };
  }

  return {
    value,
    label: value.toLocaleString(),
  };
}

function formatKda(
  kills: number | undefined,
  deaths: number | undefined,
  assists: number | undefined
): { kills: number | null; deaths: number | null; assists: number | null; label: string } {
  const values = [kills, deaths, assists];
  const hasMissingValue = values.some(
    (value) => typeof value !== "number" || Number.isNaN(value) || value < 0
  );

  if (hasMissingValue) {
    return {
      kills: typeof kills === "number" && kills >= 0 ? kills : null,
      deaths: typeof deaths === "number" && deaths >= 0 ? deaths : null,
      assists: typeof assists === "number" && assists >= 0 ? assists : null,
      label: "KDA unavailable",
    };
  }

  return {
    kills: kills as number,
    deaths: deaths as number,
    assists: assists as number,
    label: `${kills}/${deaths}/${assists}`,
  };
}

function buildTeamSummaries(matchDetails: MatchDto | null): MatchDetailsTeamSummary[] {
  if (!matchDetails?.info.teams?.length) {
    return [
      {
        teamId: 100,
        result: "Unknown",
        resultLabel: "Team result unavailable",
      },
      {
        teamId: 200,
        result: "Unknown",
        resultLabel: "Team result unavailable",
      },
    ];
  }

  return matchDetails.info.teams.map((team) => ({
    teamId: team.teamId,
    result: team.win ? "Victory" : "Defeat",
    resultLabel: team.win ? "Victory" : "Defeat",
  }));
}

function hasPartialRawDetails(matchDetails: MatchDto | null): boolean {
  if (!matchDetails?.info?.participants?.length) {
    return false;
  }

  const hasParticipantGaps = matchDetails.info.participants.some((participant) => {
    const missingSummoner = !participant.summonerName?.trim();
    const missingChampion = !participant.championName?.trim();
    const missingTeamId =
      typeof participant.teamId !== "number" || Number.isNaN(participant.teamId);
    const missingParticipantId =
      typeof participant.participantId !== "number" || Number.isNaN(participant.participantId);

    return missingSummoner || missingChampion || missingTeamId || missingParticipantId;
  });

  const hasTeamCoverage = Array.isArray(matchDetails.info.teams) && matchDetails.info.teams.length > 0;

  return hasParticipantGaps || !hasTeamCoverage;
}

function buildParticipantSummary(
  participant: MatchDto["info"]["participants"][number],
  currentPuuid: string
): MatchDetailsParticipantSummary {
  const roleMetadata = buildMatchMetadata({
    gameDuration: 0,
    teamPosition: participant.teamPosition,
    totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
    impactCategory: "guaranteedWins",
  });
  const kda = formatKda(participant.kills, participant.deaths, participant.assists);
  const visionScore = formatOptionalStat(
    participant.visionScore,
    "Vision score unavailable"
  );

  return {
    participantId: participant.participantId,
    puuid: participant.puuid,
    summonerName: participant.summonerName?.trim() || "Summoner unavailable",
    championName: participant.championName?.trim() || "Champion unavailable",
    teamId: participant.teamId,
    role: roleMetadata.role,
    roleLabel: roleMetadata.roleLabel,
    kills: kda.kills,
    deaths: kda.deaths,
    assists: kda.assists,
    kdaLabel: kda.label,
    visionScore: visionScore.value,
    visionScoreLabel:
      visionScore.value === null
        ? visionScore.label
        : `${visionScore.label} vision`,
    damageToChampions: roleMetadata.damageToChampions,
    damageToChampionsLabel: roleMetadata.damageToChampionsLabel,
    isCurrentPlayer: participant.puuid === currentPuuid,
    isMissingCoreData:
      !participant.summonerName?.trim() ||
      !participant.championName?.trim() ||
      kda.label === "KDA unavailable",
  };
}

export function buildUnavailableMatchDetailsData(matchId: string): MatchDetailsData {
  return {
    matchId,
    status: "unavailable",
    statusLabel:
      "Full match details are unavailable because cached raw match data has not been saved for this match yet.",
    fallbackReason: "missing_raw_data",
    source: "none",
    teams: [
      {
        teamId: 100,
        result: "Unknown",
        resultLabel: "Team result unavailable",
      },
      {
        teamId: 200,
        result: "Unknown",
        resultLabel: "Team result unavailable",
      },
    ],
    participants: [],
  };
}

export function buildMatchDetailsData(
  matchId: string,
  currentPuuid: string,
  matchDetails: MatchDto | null,
  source: MatchDetailsData["source"]
): MatchDetailsData {
  if (!matchDetails?.info?.participants?.length) {
    return {
      ...buildUnavailableMatchDetailsData(matchId),
      source,
    };
  }

  const isPartialRawData = hasPartialRawDetails(matchDetails);

  return {
    matchId,
    status: isPartialRawData ? "partial" : "ready",
    statusLabel: isPartialRawData
      ? "Partial match details loaded from cached raw match data. Some player or team fields are unavailable."
      : "Full match details loaded from cached raw match data.",
    fallbackReason: isPartialRawData ? "partial_raw_data" : "none",
    source,
    teams: buildTeamSummaries(matchDetails),
    participants: matchDetails.info.participants.map((participant) =>
      buildParticipantSummary(participant, currentPuuid)
    ),
  };
}
