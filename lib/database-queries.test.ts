import { describe, expect, it, vi } from "vitest";
import type { PlayerMatchRow } from "./database-queries";

const mockedSelect = vi.fn();
const mockedEq = vi.fn();
const mockedOrder = vi.fn();
const mockedRange = vi.fn();

vi.mock("./supabase-server", () => ({
  getSupabaseServer: () => ({
    from: vi.fn(() => ({
      select: mockedSelect,
    })),
  }),
}));

describe("getPlayerMatchesPaginated", () => {
  it("preserves stored role and damage metadata from player_matches rows", async () => {
    mockedRange.mockResolvedValueOnce({
      data: [
        {
          match_id: "NA1_1",
          puuid: "puuid-1",
          summoner_name: "PlayerOne",
          champion: "Ahri",
          kda: "10/2/7",
          cs: 210,
          vision_score: 18,
          game_result: "Victory",
          game_time: "31:42",
          your_impact: 7.2,
          team_impact: 4.5,
          impact_category: "impactWins",
          chart_data: [{ minute: 5, yourImpact: 1.5, teamImpact: 1.2 }],
          game_creation: 1711785600000,
          game_duration: 1902,
          rank: "PLATINUM II • 55 LP",
          rank_queue: "RANKED_SOLO_5x5",
          role: "MIDDLE",
          damage_to_champions: 24876,
        } satisfies PlayerMatchRow,
      ],
      error: null,
      count: 1,
    });

    mockedOrder.mockReturnValueOnce({ range: mockedRange });
    mockedEq.mockReturnValueOnce({ order: mockedOrder });
    mockedSelect.mockReturnValueOnce({ eq: mockedEq });

    const { getPlayerMatchesPaginated } = await import("./database-queries");
    const result = await getPlayerMatchesPaginated("puuid-1", 20, 0);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.role).toBe("MIDDLE");
    expect(result.matches[0]?.roleLabel).toBe("Mid");
    expect(result.matches[0]?.damageToChampions).toBe(24876);
    expect(result.matches[0]?.damageToChampionsLabel).toBe("24,876 damage to champions");
    expect(result.matches[0]?.rank).toBe("PLATINUM II • 55 LP");
    expect(result.matches[0]?.rankLabel).toBe("Current rank snapshot (Solo/Duo)");
  });

  it("keeps unavailable labels when stored metadata is genuinely missing", async () => {
    mockedRange.mockResolvedValueOnce({
      data: [
        {
          match_id: "NA1_2",
          puuid: "puuid-1",
          summoner_name: "PlayerOne",
          champion: "Thresh",
          kda: "1/5/14",
          cs: 34,
          vision_score: 52,
          game_result: "Defeat",
          game_time: "28:05",
          your_impact: 2.1,
          team_impact: 3.9,
          impact_category: "impactLosses",
          chart_data: [{ minute: 5, yourImpact: 0.7, teamImpact: 1.1 }],
          game_creation: 1711699200000,
          game_duration: 1685,
          rank: null,
          rank_queue: null,
          role: null,
          damage_to_champions: null,
        } satisfies PlayerMatchRow,
      ],
      error: null,
      count: 1,
    });

    mockedOrder.mockReturnValueOnce({ range: mockedRange });
    mockedEq.mockReturnValueOnce({ order: mockedOrder });
    mockedSelect.mockReturnValueOnce({ eq: mockedEq });

    const { getPlayerMatchesPaginated } = await import("./database-queries");
    const result = await getPlayerMatchesPaginated("puuid-1", 20, 0);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.role).toBeNull();
    expect(result.matches[0]?.roleLabel).toBe("Role unavailable");
    expect(result.matches[0]?.damageToChampions).toBeNull();
    expect(result.matches[0]?.damageToChampionsLabel).toBe("Damage unavailable");
    expect(result.matches[0]?.rank).toBeNull();
    expect(result.matches[0]?.rankLabel).toBe("Current rank snapshot unavailable");
  });
});
