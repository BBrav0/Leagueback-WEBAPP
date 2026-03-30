import { describe, expect, it } from "vitest";
import { buildMatchDetailsData, buildUnavailableMatchDetailsData } from "./match-details";
import type { MatchDto } from "./types";

function makeMatchDetails(): MatchDto {
  return {
    info: {
      participants: [
        {
          summonerName: "PlayerOne",
          championName: "Ahri",
          visionScore: 18,
          kills: 10,
          deaths: 2,
          assists: 7,
          totalDamageDealtToChampions: 10000,
          teamId: 100,
          puuid: "user-1",
          participantId: 1,
          teamPosition: "MIDDLE",
        },
        {
          summonerName: "PlayerTwo",
          championName: "Lee Sin",
          visionScore: 24,
          kills: 4,
          deaths: 5,
          assists: 12,
          totalDamageDealtToChampions: 8200,
          teamId: 200,
          puuid: "user-2",
          participantId: 2,
          teamPosition: "JUNGLE",
        },
      ],
      teams: [
        { teamId: 100, win: true },
        { teamId: 200, win: false },
      ],
      gameDuration: 1800,
      gameCreation: 1,
    },
  };
}

describe("buildMatchDetailsData", () => {
  it("maps raw match details into a details-friendly team and player structure", () => {
    const details = buildMatchDetailsData("match-1", "user-1", makeMatchDetails(), "match_cache");

    expect(details.status).toBe("ready");
    expect(details.statusLabel).toBe("Full match details loaded from cached raw match data.");
    expect(details.source).toBe("match_cache");
    expect(details.teams).toEqual([
      { teamId: 100, result: "Victory", resultLabel: "Victory" },
      { teamId: 200, result: "Defeat", resultLabel: "Defeat" },
    ]);
    expect(details.participants).toHaveLength(2);
    expect(details.participants[0]).toMatchObject({
      participantId: 1,
      summonerName: "PlayerOne",
      championName: "Ahri",
      role: "MIDDLE",
      roleLabel: "Mid",
      kdaLabel: "10/2/7",
      visionScore: 18,
      visionScoreLabel: "18 vision",
      damageToChampions: 10000,
      damageToChampionsLabel: "10,000 damage to champions",
      isCurrentPlayer: true,
      isMissingCoreData: false,
    });
  });

  it("returns truthful explicit fallback data when raw details are absent", () => {
    const details = buildUnavailableMatchDetailsData("match-2");

    expect(details).toEqual({
      matchId: "match-2",
      status: "unavailable",
      statusLabel:
        "Full match details are unavailable because cached raw match data has not been saved for this match yet.",
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
    });
  });

  it("marks partial participant records explicitly when core fields are missing", () => {
    const matchDetails = makeMatchDetails();
    matchDetails.info.participants[1] = {
      ...matchDetails.info.participants[1],
      summonerName: "",
      championName: "",
      kills: Number.NaN,
      teamPosition: "INVALID",
      totalDamageDealtToChampions: -1,
    };

    const details = buildMatchDetailsData("match-3", "user-1", matchDetails, "legacy_cache");
    const partialParticipant = details.participants[1];

    expect(partialParticipant).toMatchObject({
      summonerName: "Summoner unavailable",
      championName: "Champion unavailable",
      role: null,
      roleLabel: "Role unavailable",
      kdaLabel: "KDA unavailable",
      damageToChampions: null,
      damageToChampionsLabel: "Damage unavailable",
      isCurrentPlayer: false,
      isMissingCoreData: true,
    });
  });
});
