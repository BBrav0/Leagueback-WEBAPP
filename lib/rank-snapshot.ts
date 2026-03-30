export type RankQueue = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

export interface LeagueEntryDto {
  queueType?: string;
  tier?: string;
  rank?: string;
  leaguePoints?: number;
}

export interface RankSnapshot {
  rank: string;
  rankLabel: string;
  rankQueue: RankQueue;
}

const QUEUE_LABELS: Record<RankQueue, string> = {
  RANKED_SOLO_5x5: "Solo/Duo",
  RANKED_FLEX_SR: "Flex",
};

const TIER_LABELS: Record<string, string> = {
  IRON: "Iron",
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum",
  EMERALD: "Emerald",
  DIAMOND: "Diamond",
  MASTER: "Master",
  GRANDMASTER: "Grandmaster",
  CHALLENGER: "Challenger",
};

function normalizeTier(tier: string | undefined): string | null {
  if (!tier) return null;
  return TIER_LABELS[tier.trim().toUpperCase()] ?? null;
}

function normalizeDivision(rank: string | undefined): string | null {
  const normalized = rank?.trim().toUpperCase();
  if (!normalized) return null;
  return normalized;
}

function formatRankValue(entry: LeagueEntryDto): string | null {
  const tier = normalizeTier(entry.tier);
  if (!tier) {
    return null;
  }

  const division = normalizeDivision(entry.rank);
  const lp =
    typeof entry.leaguePoints === "number" && Number.isFinite(entry.leaguePoints)
      ? `${Math.max(0, Math.trunc(entry.leaguePoints))} LP`
      : null;

  return [tier, division, lp].filter(Boolean).join(" ");
}

export function selectCurrentRankSnapshot(entries: LeagueEntryDto[]): RankSnapshot | null {
  const supportedEntries = entries.filter(
    (entry): entry is LeagueEntryDto & { queueType: RankQueue } =>
      entry.queueType === "RANKED_SOLO_5x5" || entry.queueType === "RANKED_FLEX_SR"
  );

  for (const queueType of ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] as const) {
    const match = supportedEntries.find((entry) => entry.queueType === queueType);
    if (!match) {
      continue;
    }

    const rank = formatRankValue(match);
    if (!rank) {
      continue;
    }

    return {
      rank,
      rankQueue: queueType,
      rankLabel: `Current rank snapshot (${QUEUE_LABELS[queueType]})`,
    };
  }

  return null;
}