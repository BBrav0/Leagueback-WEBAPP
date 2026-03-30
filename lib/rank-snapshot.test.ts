import { describe, expect, it } from "vitest";

import { selectCurrentRankSnapshot } from "./rank-snapshot";

describe("selectCurrentRankSnapshot", () => {
  it("prefers Solo/Duo over Flex when both queues exist", () => {
    const snapshot = selectCurrentRankSnapshot([
      { queueType: "RANKED_FLEX_SR", tier: "GOLD", rank: "I", leaguePoints: 20 },
      { queueType: "RANKED_SOLO_5x5", tier: "PLATINUM", rank: "II", leaguePoints: 55 },
    ]);

    expect(snapshot).toEqual({
      rank: "Platinum II 55 LP",
      rankQueue: "RANKED_SOLO_5x5",
      rankLabel: "Current rank snapshot (Solo/Duo)",
    });
  });

  it("falls back to Flex when Solo/Duo is unavailable", () => {
    const snapshot = selectCurrentRankSnapshot([
      { queueType: "RANKED_FLEX_SR", tier: "EMERALD", rank: "IV", leaguePoints: 0 },
    ]);

    expect(snapshot).toEqual({
      rank: "Emerald IV 0 LP",
      rankQueue: "RANKED_FLEX_SR",
      rankLabel: "Current rank snapshot (Flex)",
    });
  });

  it("returns null when no supported rank entry can be formatted", () => {
    expect(
      selectCurrentRankSnapshot([
        { queueType: "RANKED_TFT", tier: "GOLD", rank: "I", leaguePoints: 10 },
        { queueType: "RANKED_SOLO_5x5", tier: "", rank: "II", leaguePoints: 55 },
      ])
    ).toBeNull();
  });
});
