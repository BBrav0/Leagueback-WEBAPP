"use client";

import type { MatchSummary } from "./bridge";

export type HistoryResultFilter = "all" | "Victory" | "Defeat";
export type HistoryImpactFilter = "all" | MatchSummary["impactCategory"];
export type HistorySortPreference = "newest" | "oldest" | "highestImpact";

export interface HistoryPreferences {
  result: HistoryResultFilter;
  impactCategory: HistoryImpactFilter;
  champion: string;
  sort: HistorySortPreference;
  compactCards: boolean;
}

export const HISTORY_PREFERENCES_STORAGE_KEY = "leagueback_history_preferences";

export const DEFAULT_HISTORY_PREFERENCES: HistoryPreferences = {
  result: "all",
  impactCategory: "all",
  champion: "",
  sort: "newest",
  compactCards: false,
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeChampion(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeResult(value: unknown): HistoryResultFilter {
  return value === "Victory" || value === "Defeat" ? value : "all";
}

function normalizeImpact(value: unknown): HistoryImpactFilter {
  return value === "impactWins" ||
    value === "impactLosses" ||
    value === "guaranteedWins" ||
    value === "guaranteedLosses"
    ? value
    : "all";
}

function normalizeSort(value: unknown): HistorySortPreference {
  return value === "oldest" || value === "highestImpact" ? value : "newest";
}

function normalizeCompactCards(value: unknown): boolean {
  return value === true;
}

export function sanitizeHistoryPreferences(
  value: Partial<HistoryPreferences> | null | undefined
): HistoryPreferences {
  return {
    result: normalizeResult(value?.result),
    impactCategory: normalizeImpact(value?.impactCategory),
    champion: normalizeChampion(value?.champion),
    sort: normalizeSort(value?.sort),
    compactCards: normalizeCompactCards(value?.compactCards),
  };
}

export function loadHistoryPreferences(): HistoryPreferences {
  if (!canUseStorage()) {
    return DEFAULT_HISTORY_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_HISTORY_PREFERENCES;
    }

    return sanitizeHistoryPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_HISTORY_PREFERENCES;
  }
}

export function hasStoredHistoryPreferences(): boolean {
  if (!canUseStorage()) {
    return false;
  }

  return window.localStorage.getItem(HISTORY_PREFERENCES_STORAGE_KEY) !== null;
}

export function saveHistoryPreferences(
  preferences: Partial<HistoryPreferences>
): HistoryPreferences {
  const nextPreferences = sanitizeHistoryPreferences(preferences);

  if (canUseStorage()) {
    window.localStorage.setItem(
      HISTORY_PREFERENCES_STORAGE_KEY,
      JSON.stringify(nextPreferences)
    );
  }

  return nextPreferences;
}

export function resetHistoryPreferences(): HistoryPreferences {
  if (canUseStorage()) {
    window.localStorage.removeItem(HISTORY_PREFERENCES_STORAGE_KEY);
  }

  return DEFAULT_HISTORY_PREFERENCES;
}

export function filterAndSortMatches(
  matches: MatchSummary[],
  preferences: HistoryPreferences
): MatchSummary[] {
  const championQuery = preferences.champion.trim().toLocaleLowerCase();

  const filtered = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => {
    if (preferences.result !== "all" && match.gameResult !== preferences.result) {
      return false;
    }

    if (
      preferences.impactCategory !== "all" &&
      match.impactCategory !== preferences.impactCategory
    ) {
      return false;
    }

    if (
      championQuery &&
      !match.champion.toLocaleLowerCase().includes(championQuery)
    ) {
      return false;
    }

    return true;
  });

  return [...filtered].sort((a, b) => {
    if (preferences.sort === "oldest") {
      return a.index - b.index;
    }

    if (preferences.sort === "highestImpact") {
      return b.match.yourImpact - a.match.yourImpact;
    }

    return 0;
  }).map(({ match }) => match);
}

export function countActiveHistoryFilters(preferences: HistoryPreferences): number {
  let activeCount = 0;

  if (preferences.result !== "all") activeCount += 1;
  if (preferences.impactCategory !== "all") activeCount += 1;
  if (preferences.champion.trim()) activeCount += 1;

  return activeCount;
}
