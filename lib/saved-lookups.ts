"use client";

export interface SavedLookup {
  gameName: string;
  tagLine: string;
}

export const SAVED_LOOKUPS_STORAGE_KEY = "leagueback_saved_lookups";
const MAX_SAVED_LOOKUPS = 5;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function normalizeTagLine(tagLine: string, gameName?: string): string {
  const trimmedTagLine = tagLine.trim();
  const trimmedGameName = gameName?.trim() ?? "";

  if (!trimmedTagLine) {
    return "";
  }

  const withoutLeadingHash = trimmedTagLine.replace(/^#+/, "").trim();
  if (!withoutLeadingHash) {
    return "";
  }

  const gameNamePrefix =
    trimmedGameName && withoutLeadingHash.startsWith(`${trimmedGameName}#`)
      ? withoutLeadingHash.slice(trimmedGameName.length + 1)
      : withoutLeadingHash;

  if (!gameNamePrefix) {
    return "";
  }

  const segments = gameNamePrefix
    .split("#")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return "";
  }

  if (segments.length === 1) {
    return segments[0];
  }

  return segments[segments.length - 1];
}

function normalizeLookup(lookup: SavedLookup): SavedLookup | null {
  const gameName = lookup.gameName.trim();
  const tagLine = normalizeTagLine(lookup.tagLine, lookup.gameName);

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

  return parseStoredLookups(window.localStorage.getItem(SAVED_LOOKUPS_STORAGE_KEY));
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

  window.localStorage.setItem(SAVED_LOOKUPS_STORAGE_KEY, JSON.stringify(nextLookups));
  return nextLookups;
}

export function subscribeToSavedLookups(
  onChange: (lookups: SavedLookup[]) => void
): () => void {
  if (typeof window === "undefined") {
    onChange([]);
    return () => undefined;
  }

  const sync = () => {
    onChange(loadSavedLookups());
  };

  sync();
  window.addEventListener("storage", sync);

  return () => {
    window.removeEventListener("storage", sync);
  };
}
