"use client";

export interface SavedLookup {
  gameName: string;
  tagLine: string;
}

const STORAGE_KEY = "leagueback_saved_lookups";
const MAX_SAVED_LOOKUPS = 5;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeLookup(lookup: SavedLookup): SavedLookup | null {
  const gameName = lookup.gameName.trim();
  const tagLine = lookup.tagLine.trim();

  if (!gameName || !tagLine) {
    return null;
  }

  return { gameName, tagLine };
}

function sameLookup(a: SavedLookup, b: SavedLookup): boolean {
  return (
    a.gameName.localeCompare(b.gameName, undefined, { sensitivity: "accent" }) === 0 &&
    a.tagLine.localeCompare(b.tagLine, undefined, { sensitivity: "accent" }) === 0
  );
}

function parseStoredLookups(raw: string | null): SavedLookup[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) =>
        normalizeLookup({
          gameName: typeof item?.gameName === "string" ? item.gameName : "",
          tagLine: typeof item?.tagLine === "string" ? item.tagLine : "",
        })
      )
      .filter((item): item is SavedLookup => item !== null)
      .slice(0, MAX_SAVED_LOOKUPS);
  } catch {
    return [];
  }
}

export function loadSavedLookups(): SavedLookup[] {
  if (!canUseStorage()) {
    return [];
  }

  return parseStoredLookups(window.localStorage.getItem(STORAGE_KEY));
}

export function saveSuccessfulLookup(lookup: SavedLookup): SavedLookup[] {
  const normalized = normalizeLookup(lookup);
  if (!normalized || !canUseStorage()) {
    return loadSavedLookups();
  }

  const nextLookups = [
    normalized,
    ...loadSavedLookups().filter((entry) => !sameLookup(entry, normalized)),
  ].slice(0, MAX_SAVED_LOOKUPS);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLookups));
  return nextLookups;
}
