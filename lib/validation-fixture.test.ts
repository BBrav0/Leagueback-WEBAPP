import { describe, expect, it } from "vitest";

import {
  isValidationFixtureIdentity,
  VALIDATION_FIXTURE_DETAILS,
  VALIDATION_FIXTURE_MATCHES,
  getValidationFixtureStoredMatches,
} from "./validation-fixture";

describe("validation fixture path", () => {
  it("recognizes the documented deterministic Riot ID through the normal search fields", () => {
    expect(isValidationFixtureIdentity("Validation Fixture", "LOCAL")).toBe(true);
    expect(isValidationFixtureIdentity(" validation fixture ", " local ")).toBe(true);
    expect(isValidationFixtureIdentity("Someone Else", "LOCAL")).toBe(false);
  });

  it("provides enriched match cards plus one ready and one fallback details case", () => {
    expect(VALIDATION_FIXTURE_MATCHES).toHaveLength(2);
    expect(VALIDATION_FIXTURE_MATCHES.map((match) => match.id)).toEqual([
      "VALIDATION_READY_001",
      "VALIDATION_FALLBACK_002",
    ]);
    expect(VALIDATION_FIXTURE_MATCHES[0].impactCategoryLabel).toBeTruthy();
    expect(VALIDATION_FIXTURE_MATCHES[0].playedAt).toContain("Validation fixture");
    expect(VALIDATION_FIXTURE_MATCHES[1].damageToChampionsLabel).toContain("damage to champions");

    expect(VALIDATION_FIXTURE_DETAILS.VALIDATION_READY_001.status).toBe("ready");
    expect(VALIDATION_FIXTURE_DETAILS.VALIDATION_READY_001.participants.some((participant) => participant.isCurrentPlayer)).toBe(true);
    expect(VALIDATION_FIXTURE_DETAILS.VALIDATION_FALLBACK_002.status).toBe("unavailable");
    expect(VALIDATION_FIXTURE_DETAILS.VALIDATION_FALLBACK_002.statusLabel).toContain("truthful fallback");
  });

  it("pages fixture stored matches through the same runtime shape as /api/stored-matches", () => {
    expect(getValidationFixtureStoredMatches(1, 0)).toEqual({
      matches: [VALIDATION_FIXTURE_MATCHES[0]],
      totalCount: 2,
      hasMore: true,
    });
    expect(getValidationFixtureStoredMatches(1, 1)).toEqual({
      matches: [VALIDATION_FIXTURE_MATCHES[1]],
      totalCount: 2,
      hasMore: false,
    });
  });
});
