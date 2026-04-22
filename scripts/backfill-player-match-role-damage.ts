import { neon } from "@neondatabase/serverless";

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

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Missing DATABASE_URL environment variable. Set it before running the backfill."
  );
}

const sql = neon(databaseUrl);

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
  const rows = await sql`
    SELECT match_id, puuid
    FROM player_matches
    WHERE role IS NULL OR damage_to_champions IS NULL
    ORDER BY game_creation ASC
    LIMIT ${limit}
  `;
  return rows as PlayerMatchNeedingBackfillRow[];
}

async function fetchMatchCacheRows(matchIds: string[]): Promise<MatchCacheRow[]> {
  if (matchIds.length === 0) {
    return [];
  }

  const rows = await sql`
    SELECT match_id, match_data
    FROM match_cache
    WHERE match_id = ANY(${matchIds})
  `;
  return rows as MatchCacheRow[];
}

async function applyUpdates(rows: BackfillUpdateRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  // Build a multi-row upsert using UNNEST for parameterized batch insert
  const matchIds = rows.map((r) => r.match_id);
  const puuids = rows.map((r) => r.puuid);
  const roles = rows.map((r) => r.role);
  const damages = rows.map((r) => r.damage_to_champions);

  await sql`
    INSERT INTO player_matches (match_id, puuid, role, damage_to_champions)
    SELECT * FROM UNNEST(
      ${matchIds}::text[],
      ${puuids}::text[],
      ${roles}::text[],
      ${damages}::integer[]
    ) AS t(match_id, puuid, role, damage_to_champions)
    ON CONFLICT (match_id, puuid)
    DO UPDATE SET
      role = EXCLUDED.role,
      damage_to_champions = EXCLUDED.damage_to_champions
  `;
}

async function countRemainingCandidates(): Promise<number | null> {
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM player_matches
      WHERE role IS NULL OR damage_to_champions IS NULL
    `;
    return (rows as { count: number }[])[0]?.count ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[backfill-role-damage] Remaining-count query failed: ${message}`);
    return null;
  }
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
