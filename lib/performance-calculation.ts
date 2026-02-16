import type {
  MatchDto,
  MatchTimelineDto,
  ChartDataPoint,
} from "./types";

interface PlayerStatsAtTime {
  participantId: number;
  summonerName: string;
  championName: string;
  lane: string;
  teamId: number; // 1 = ally, 2 = enemy
  kills: number;
  deaths: number;
  assists: number;
}

function getKillValue(minute: number): number {
  if (minute <= 1) return 25.0;
  if (minute <= 5) return 20.0;
  if (minute <= 10) return 17.5;
  if (minute <= 14) return 15.0;
  if (minute <= 20) return 10.0;
  if (minute <= 30) return 5.0;
  return 2.5;
}

function getPlayerStatsAtMinute(
  minute: number,
  matchDetails: MatchDto,
  matchTimeline: MatchTimelineDto,
  userTeamId: number
): PlayerStatsAtTime[] {
  const statsDictionary = new Map<number, PlayerStatsAtTime>();

  for (const p of matchDetails.info.participants) {
    statsDictionary.set(p.participantId, {
      participantId: p.participantId,
      summonerName: p.summonerName,
      championName: p.championName,
      lane: p.teamPosition,
      teamId: p.teamId === userTeamId ? 1 : 2,
      kills: 0,
      deaths: 0,
      assists: 0,
    });
  }

  for (let i = 1; i <= minute && i < matchTimeline.info.frames.length; i++) {
    const frame = matchTimeline.info.frames[i];
    for (const event of frame.events) {
      if (event.type === "CHAMPION_KILL") {
        const victim = statsDictionary.get(event.victimId);
        if (victim) victim.deaths++;

        const killer = statsDictionary.get(event.killerId);
        if (killer) killer.kills++;

        if (event.assistingParticipantIds) {
          for (const assistId of event.assistingParticipantIds) {
            const assister = statsDictionary.get(assistId);
            if (assister) assister.assists++;
          }
        }
      }
    }
  }

  return Array.from(statsDictionary.values());
}

export function generateChartData(
  matchDetails: MatchDto,
  matchTimeline: MatchTimelineDto,
  userPuuid: string
): ChartDataPoint[] {
  const dataPoints: ChartDataPoint[] = [];

  const userParticipant = matchDetails.info.participants.find(
    (p) => p.puuid === userPuuid
  );
  if (!userParticipant) return dataPoints;

  const timestampsToReport = new Set([1, 5, 10, 14, 20, 25, 30]);
  const gameDurationInMinutes = Math.floor(matchDetails.info.gameDuration / 60);

  let cumulativeSoloScore = 0;
  let cumulativeTeamScore = 0;
  let previousMinuteStats: PlayerStatsAtTime[] = [];

  const soloScores: number[] = [];
  const teamScores: number[] = [];

  for (
    let minute = 1;
    minute <= gameDurationInMinutes &&
    minute < matchTimeline.info.frames.length;
    minute++
  ) {
    const killValue = getKillValue(minute);
    const deathValue = -killValue;
    const assistValue = killValue / 2;

    const currentMinuteStats = getPlayerStatsAtMinute(
      minute,
      matchDetails,
      matchTimeline,
      userParticipant.teamId
    );

    const meCurrent = currentMinuteStats.find(
      (p) => p.participantId === userParticipant.participantId
    );
    if (!meCurrent) continue;

    let myKillsThisMinute = meCurrent.kills;
    let myDeathsThisMinute = meCurrent.deaths;
    let myAssistsThisMinute = meCurrent.assists;
    let allyTeamKillsThisMinute = currentMinuteStats
      .filter((p) => p.teamId === 1)
      .reduce((sum, p) => sum + p.kills, 0);
    let enemyTeamKillsThisMinute = currentMinuteStats
      .filter((p) => p.teamId === 2)
      .reduce((sum, p) => sum + p.kills, 0);

    if (previousMinuteStats.length > 0) {
      const meLast = previousMinuteStats.find(
        (p) => p.participantId === userParticipant.participantId
      ) ?? { kills: 0, deaths: 0, assists: 0 };
      myKillsThisMinute -= meLast.kills;
      myDeathsThisMinute -= meLast.deaths;
      myAssistsThisMinute -= meLast.assists;

      allyTeamKillsThisMinute -= previousMinuteStats
        .filter((p) => p.teamId === 1)
        .reduce((sum, p) => sum + p.kills, 0);
      enemyTeamKillsThisMinute -= previousMinuteStats
        .filter((p) => p.teamId === 2)
        .reduce((sum, p) => sum + p.kills, 0);
    }

    cumulativeSoloScore +=
      myKillsThisMinute * killValue +
      myDeathsThisMinute * deathValue +
      myAssistsThisMinute * assistValue;
    cumulativeTeamScore +=
      allyTeamKillsThisMinute * killValue -
      enemyTeamKillsThisMinute * killValue;

    if (timestampsToReport.has(minute)) {
      dataPoints.push({
        minute,
        yourImpact: cumulativeSoloScore,
        teamImpact: cumulativeTeamScore / 4,
      });
      soloScores.push(cumulativeSoloScore);
      teamScores.push(cumulativeTeamScore / 4);
    }

    previousMinuteStats = currentMinuteStats;
  }

  // Final data point
  const finalMinute = gameDurationInMinutes > 30 ? 35 : gameDurationInMinutes;
  dataPoints.push({
    minute: finalMinute,
    yourImpact: cumulativeSoloScore,
    teamImpact: cumulativeTeamScore / 4,
  });
  soloScores.push(cumulativeSoloScore);
  teamScores.push(cumulativeTeamScore / 4);

  // Minute -1: average of all recorded data points (used for impact categorization)
  const avgYour =
    soloScores.length > 0
      ? soloScores.reduce((a, b) => a + b, 0) / soloScores.length
      : 0;
  const avgTeam =
    teamScores.length > 0
      ? teamScores.reduce((a, b) => a + b, 0) / teamScores.length
      : 0;

  dataPoints.push({
    minute: -1,
    yourImpact: avgYour,
    teamImpact: avgTeam,
  });

  return dataPoints;
}
