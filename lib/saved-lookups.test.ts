// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSavedLookups, saveSuccessfulLookup } from "./saved-lookups";

describe("saved-lookups", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("stores successful lookups with trimmed values", () => {
    const saved = saveSuccessfulLookup({ gameName: "  Faker  ", tagLine: "  KR1 " });

    expect(saved).toEqual([{ gameName: "Faker", tagLine: "KR1" }]);
    expect(loadSavedLookups()).toEqual([{ gameName: "Faker", tagLine: "KR1" }]);
  });

  it("deduplicates repeated successful lookups and moves them to the front", () => {
    saveSuccessfulLookup({ gameName: "Caps", tagLine: "EUW" });
    saveSuccessfulLookup({ gameName: "Faker", tagLine: "KR1" });

    const saved = saveSuccessfulLookup({ gameName: "Caps", tagLine: "EUW" });

    expect(saved).toEqual([
      { gameName: "Caps", tagLine: "EUW" },
      { gameName: "Faker", tagLine: "KR1" },
    ]);
  });

  it("ignores invalid or corrupted saved data", () => {
    localStorage.setItem("leagueback_saved_lookups", "not-json");
    expect(loadSavedLookups()).toEqual([]);

    localStorage.setItem("leagueback_saved_lookups", JSON.stringify([{ bad: true }]));
    expect(loadSavedLookups()).toEqual([]);
  });

  it("does not persist incomplete lookups", () => {
    saveSuccessfulLookup({ gameName: "Faker", tagLine: "KR1" });

    const saved = saveSuccessfulLookup({ gameName: "OnlyName", tagLine: "   " });

    expect(saved).toEqual([{ gameName: "Faker", tagLine: "KR1" }]);
    expect(loadSavedLookups()).toEqual([{ gameName: "Faker", tagLine: "KR1" }]);
  });

  it("limits saved lookups to the newest five entries", () => {
    ["A", "B", "C", "D", "E", "F"].forEach((name) => {
      saveSuccessfulLookup({ gameName: name, tagLine: "NA1" });
    });

    expect(loadSavedLookups()).toEqual([
      { gameName: "F", tagLine: "NA1" },
      { gameName: "E", tagLine: "NA1" },
      { gameName: "D", tagLine: "NA1" },
      { gameName: "C", tagLine: "NA1" },
      { gameName: "B", tagLine: "NA1" },
    ]);
  });
});
