import { createClient } from "@supabase/supabase-js";

interface PlayerMatchNeedingBackfillRow {
  match_id: string;
  puuid: string;
}

interface MatchCacheRow {
  match_id: string;
  match_data: {
    info?: {
      participants?: MatchParticipant[];
    };
  } | null;
}

interface MatchParticipant {
  puuid?: string;
  teamPosition?: string | null;
  totalDamageDealtToChampions?: number | null;
}

interface BackfillUpdateRow {
  match_id: string;
  puuid: string;
  role: string | null;
  damage_to_champions: number | null;
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing Supabase environment variables. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running the backfill."
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeRole(teamPosition: string | null | undefined): string | null {
  const normalized = teamPosition?.trim().toUpperCase();
  if (!normalized || normalized === "INVALID") {
    return null;
  }

  return normalized;
}

function normalizeDamage(totalDamageDealtToChampions: number | null | undefined): number | null {
  if (
    typeof totalDamageDealtToChampions !== "number" ||
    Number.isNaN(totalDamageDealtToChampions) ||
    totalDamageDealtToChampions < 0
  ) {
    return null;
  }

  return totalDamageDealtToChampions;
}

function buildParticipantIndex(rows: MatchCacheRow[]): Map<string, MatchParticipant[]> {
  const participantsByMatchId = new Map<string, MatchParticipant[]>();

  for (const row of rows) {
    const participants = row.match_data?.info?.participants;
    if (Array.isArray(participants) && participants.length > 0) {
      participantsByMatchId.set(row.match_id, participants);
    }
  }

  return participantsByMatchId;
}

async function fetchBackfillCandidates(limit: number): Promise<PlayerMatchNeedingBackfillRow[]> {
  const { data, error } = await supabase
    .from("player_matches")
    .select("match_id, puuid")
    .or("role.is.null,damage_to_champions.is.null")
    .order("game_creation", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load player_matches backfill candidates: ${error.message}`);
  }

  return (data as PlayerMatchNeedingBackfillRow[] | null) ?? [];
}

async function fetchMatchCacheRows(matchIds: string[]): Promise<MatchCacheRow[]> {
  if (matchIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("match_cache")
    .select("match_id, match_data")
    .in("match_id", matchIds);

  if (error) {
    throw new Error(`Failed to load match_cache rows: ${error.message}`);
  }

  return (data as MatchCacheRow[] | null) ?? [];
}

async function applyUpdates(rows: BackfillUpdateRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("player_matches")
    .upsert(rows, { onConflict: "match_id,puuid" });

  if (error) {
    throw new Error(`Failed to upsert player_matches backfill rows: ${error.message}`);
  }
}

async function countRemainingCandidates(): Promise<number | null> {
  const { count, error } = await supabase
    .from("player_matches")
    .select("match_id", { count: "exact", head: true })
    .or("role.is.null,damage_to_champions.is.null");

  if (error) {
    console.warn(`[backfill-role-damage] Remaining-count query failed: ${error.message}`);
    return null;
  }

  return count ?? 0;
}

async function main(): Promise<void> {
  const batchSize = parsePositiveInt(process.env.BACKFILL_BATCH_SIZE, 250);
  const maxBatches = parsePositiveInt(process.env.BACKFILL_MAX_BATCHES, 1);

  let processedCandidates = 0;
  let updatedRows = 0;
  let skippedRows = 0;

  console.log(
    `[backfill-role-damage] Starting with batchSize=${batchSize} maxBatches=${maxBatches}`
  );

  for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber += 1) {
    const candidates = await fetchBackfillCandidates(batchSize);

    if (candidates.length === 0) {
      console.log("[backfill-role-damage] No remaining rows require backfill.");
      break;
    }

    processedCandidates += candidates.length;

    const uniqueMatchIds = Array.from(new Set(candidates.map((row) => row.match_id)));
    const matchCacheRows = await fetchMatchCacheRows(uniqueMatchIds);
    const participantsByMatchId = buildParticipantIndex(matchCacheRows);

    const updates: BackfillUpdateRow[] = [];

    for (const candidate of candidates) {
      const participants = participantsByMatchId.get(candidate.match_id);
      const participant = participants?.find((entry) => entry.puuid === candidate.puuid);

      if (!participant) {
        skippedRows += 1;
        continue;
      }

      updates.push({
        match_id: candidate.match_id,
        puuid: candidate.puuid,
        role: normalizeRole(participant.teamPosition),
        damage_to_champions: normalizeDamage(participant.totalDamageDealtToChampions),
      });
    }

    await applyUpdates(updates);
    updatedRows += updates.length;

    console.log(
      `[backfill-role-damage] Batch ${batchNumber}/${maxBatches}: candidates=${candidates.length} updated=${updates.length} skipped_without_match_cache_participant=${skippedRows}`
    );

    if (candidates.length < batchSize) {
      break;
    }
  }

  const remaining = await countRemainingCandidates();

  console.log(
    `[backfill-role-damage] Finished processedCandidates=${processedCandidates} updatedRows=${updatedRows} skippedRows=${skippedRows} remainingCandidates=${remaining ?? "unknown"}`
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backfill-role-damage] Failed: ${message}`);
  process.exitCode = 1;
});
