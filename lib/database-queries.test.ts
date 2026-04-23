import { describe, expect, it, vi } from "vitest";
import type { PlayerMatchRow } from "./database-queries";

// Mock the Neon module to control what sql template/query calls return
const mockQuery = vi.fn();
const mockSql = Object.assign(vi.fn(), { query: mockQuery });

vi.mock("./neon", () => ({
  getSql: () => mockSql,
}));

describe("getPlayerMatchesPaginated", () => {
  it("preserves stored role and damage metadata from player_matches rows", async () => {
    // getPlayerMatchesPaginated uses .query() with COUNT(*) OVER()
    // total_count is embedded in each row via the window function
    mockQuery.mockResolvedValueOnce([
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
        total_count: 1,
      } satisfies PlayerMatchRow & { total_count: number },
    ]);

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
    // .query() with COUNT(*) OVER() — total_count embedded in row
    mockQuery.mockResolvedValueOnce([
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
        total_count: 1,
      } satisfies PlayerMatchRow & { total_count: number },
    ]);

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

  it("surfaces database query failures instead of masking them as empty history", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));

    const { getPlayerMatchesPaginated } = await import("./database-queries");

    await expect(getPlayerMatchesPaginated("puuid-1", 20, 0)).rejects.toThrow("db exploded");
  });
});
