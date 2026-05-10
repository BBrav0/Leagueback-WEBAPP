import "server-only";

import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All allowed analytics event names. */
export const VALID_EVENT_NAMES: readonly string[] = [
  // Browser / client events
  "page_view",
  "visitor_activity",
  "search_attempt",
  "lookup_success",
  "lookup_failure",
  "player_page_view",
  "match_detail_view",
  "load_more",
  "manual_update",
  "client_error",

  // Server / API route events
  "endpoint_outcome",
  "endpoint_error",
] as const;

/** Placeholder constant for API surface — not used directly in validation. */
export const VALIDATE_PROPERTIES = true;

/** Max length for property keys. */
export const MAX_PROPERTY_KEY_LENGTH = 48;

/** Max length for property string values. */
export const MAX_PROPERTY_STRING_LENGTH = 512;

/** Max number of top-level properties per event. */
export const MAX_PROPERTY_COUNT = 24;

/** Max allowed nesting depth for property values. */
export const MAX_NESTING_DEPTH = 2;

/** Max allowed age for client-provided timestamps (24h in ms). */
const MAX_TIMESTAMP_AGE_MS = 24 * 60 * 60 * 1000;

/** Regex for valid visitor/session IDs: alphanumeric, dash, underscore. */
const ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

/** Patterns indicating secret-like values that must be scrubbed. */
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /auth/i,
  /password/i,
  /cookie/i,
  /session/i,
  /bearer/i,
  /db[_-]?url/i,
  /database[_-]?url/i,
  /connection[_-]?string/i,
  /postgres(ql)?:\/\//i,
  /sk_live/i,
  /sk_test/i,
];

// ---------------------------------------------------------------------------
// Event name validation
// ---------------------------------------------------------------------------

/**
 * Validates that an event name is in the allowlist.
 * Returns true if valid, false otherwise.
 */
export function validateEventName(name: string): boolean {
  return VALID_EVENT_NAMES.includes(name);
}

// ---------------------------------------------------------------------------
// Property sanitization
// ---------------------------------------------------------------------------

/**
 * Checks nesting depth of a value. Returns true if within bounds.
 */
export function isWithinNestingDepth(value: unknown, maxDepth: number): boolean {
  if (maxDepth < 0) return false;
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) {
    return value.every((v) => isWithinNestingDepth(v, maxDepth - 1));
  }
  const record = value as Record<string, unknown>;
  return Object.values(record).every((v) =>
    isWithinNestingDepth(v, maxDepth - 1)
  );
}

/**
 * Checks if a key looks like it might contain a secret/sensitive value.
 */
export function isSecretKey(key: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Truncates a string value to the maximum allowed length.
 */
function truncateValue(value: string): string {
  return value.length > MAX_PROPERTY_STRING_LENGTH
    ? value.slice(0, MAX_PROPERTY_STRING_LENGTH)
    : value;
}

/**
 * Sanitize and bound event properties.
 * - Drops keys exceeding max key length
 * - Drops secret-like keys
 * - Truncates oversized string values
 * - Drops deeply nested values
 * - Drops excess properties beyond max count
 * - Converts non-primitive values to safe representations
 */
export function sanitizeProperties(
  input: unknown
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  const entries = Object.entries(source)
    // Drop oversized keys
    .filter(([key]) => key.length <= MAX_PROPERTY_KEY_LENGTH)
    // Drop secret-like keys
    .filter(([key]) => !isSecretKey(key))
    // Limit to max property count
    .slice(0, MAX_PROPERTY_COUNT);

  for (const [key, value] of entries) {
    if (value === null || value === undefined) {
      continue;
    }

    // Handle primitive types
    if (typeof value === "string") {
      result[key] = truncateValue(value);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
    } else if (typeof value === "object") {
      // Check nesting depth
      if (!isWithinNestingDepth(value, MAX_NESTING_DEPTH)) {
        continue; // Drop deeply nested values
      }
      // For shallow objects/arrays, JSON-serialize with truncation
      try {
        const serialized = JSON.stringify(value);
        result[key] = truncateValue(serialized);
      } catch {
        continue; // Drop unserializable values
      }
    }
    // Ignore functions, symbols, etc.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Timestamp bounding
// ---------------------------------------------------------------------------

/**
 * Bounds a client-provided timestamp.
 * - Invalid/missing timestamps → server now
 * - Future timestamps → server now
 * - Timestamps older than 24h → server now
 * - Reasonable timestamps → preserved (server-verified)
 */
export function boundTimestamp(clientTs?: string): Date {
  const now = new Date();

  if (!clientTs || typeof clientTs !== "string") {
    return now;
  }

  const parsed = new Date(clientTs);
  if (isNaN(parsed.getTime())) {
    return now;
  }

  // Reject future timestamps
  if (parsed.getTime() > now.getTime()) {
    return now;
  }

  // Reject timestamps older than 24 hours
  const age = now.getTime() - parsed.getTime();
  if (age > MAX_TIMESTAMP_AGE_MS) {
    return now;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Visitor / session ID validation
// ---------------------------------------------------------------------------

/**
 * Validates visitor ID format (alphanumeric, dash, underscore, 8-64 chars).
 */
export function validateVisitorId(id: string): boolean {
  return ID_REGEX.test(id);
}

/**
 * Validates session ID format (alphanumeric, dash, underscore, 8-64 chars).
 */
export function validateSessionId(id: string): boolean {
  return ID_REGEX.test(id);
}

// ---------------------------------------------------------------------------
// Identifier hashing
// ---------------------------------------------------------------------------


/** Minimum length for a valid ANALYTICS_HMAC_KEY. */
const MIN_HMAC_KEY_LENGTH = 32;

/**
 * Resolves the server-only HMAC key for identifier hashing.
 * Requires ANALYTICS_HMAC_KEY env var — no public fallback.
 * Throws if missing or too short so misconfigured servers fail loudly
 * at hash time rather than silently producing publicly-reproducible hashes.
 */
function getHmacKey(): string {
  const key = process.env.ANALYTICS_HMAC_KEY;
  if (!key || key.length < MIN_HMAC_KEY_LENGTH) {
    throw new Error(
      "ANALYTICS_HMAC_KEY is required (min 32 chars) for identifier hashing. " +
      "Set this server-only env var before running analytics."
    );
  }
  return key;
}

/**
 * Keyed HMAC-SHA-256 hash for Riot identifiers.
 * Uses a server-only key (ANALYTICS_HMAC_KEY env var) to produce
 * non-reversible, non-publicly-reproducible hashes. Callers without
 * the server key cannot recompute the hash.
 */
export function hashIdentifier(
  gameName: string,
  tagLine: string
): string {
  const key = getHmacKey();
  const input = `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
  return createHmac("sha256", key).update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Route path sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitizes a route path to remove player-identifying segments and query strings.
 * - /player/SomeName/EUW1 → /player
 * - /?foo=bar → /
 * - /dashboard → /dashboard
 */
export function sanitizeRoutePath(rawPath: unknown): string {
  if (!rawPath || typeof rawPath !== "string") {
    return "/";
  }

  let path = rawPath;

  // Strip query string
  const queryIndex = path.indexOf("?");
  if (queryIndex !== -1) {
    path = path.slice(0, queryIndex);
  }

  // Strip fragment
  const hashIndex = path.indexOf("#");
  if (hashIndex !== -1) {
    path = path.slice(0, hashIndex);
  }

  // Strip player-identifying segments
  if (path.startsWith("/player/")) {
    return "/player";
  }

  // Ensure leading slash
  if (!path.startsWith("/")) {
    return "/";
  }

  return path || "/";
}

// ---------------------------------------------------------------------------
// Analytics event recording (fail-open)
// ---------------------------------------------------------------------------

/** Result of an analytics write attempt. */
export interface AnalyticsWriteResult {
  success: boolean;
  reason?: string;
}

/**
 * Records an analytics event. Always resolves (never rejects).
 * Analytics write failures are non-blocking for product flows.
 *
 * @param eventName - Must be in VALID_EVENT_NAMES
 * @param visitorId - Client visitor ID (validated)
 * @param sessionId - Client session ID (validated)
 * @param properties - Raw properties (sanitized before storage)
 * @param neonClient - Neon SQL client (mockable for tests)
 * @param clientTimestamp - Optional client-provided ISO timestamp (bounded server-side)
 */
export async function recordAnalyticsEvent(
  eventName: string,
  visitorId: string,
  sessionId: string,
  properties: Record<string, unknown>,
  neonClient: { sql: (...args: any[]) => Promise<any[]> },
  clientTimestamp?: string
): Promise<AnalyticsWriteResult> {
  // Validate event name
  if (!validateEventName(eventName)) {
    return { success: false, reason: "invalid_event_name" };
  }

  // Validate IDs
  if (!validateVisitorId(visitorId) || !validateSessionId(sessionId)) {
    return { success: false, reason: "invalid_ids" };
  }

  // Sanitize properties
  const sanitizedProps = sanitizeProperties(properties);

  // Normalize and bound timestamp: if client provides one, clamp it;
  // otherwise use server time. This prevents unbounded historical/future records.
  const timestamp = boundTimestamp(clientTimestamp);

  // Fail-open write
  try {
    await neonClient.sql`
      INSERT INTO analytics_events (event_name, visitor_id, session_id, properties, created_at)
      VALUES (${eventName}, ${visitorId}, ${sessionId}, ${JSON.stringify(sanitizedProps)}, ${timestamp.toISOString()})
    `;
    return { success: true };
  } catch (error: unknown) {
    // Log but never throw — analytics failures are non-blocking
    if (process.env.NODE_ENV !== "test") {
      console.error("Analytics write failed:", error instanceof Error ? error.message : String(error));
    }
    return { success: false, reason: "write_failed" };
  }
}

// ---------------------------------------------------------------------------
// Summary query primitives
// ---------------------------------------------------------------------------

/** Summary result structure. */
export interface AnalyticsSummaryResult {
  success: boolean;
  data?: {
    daily: Array<{ day: string; event_name: string; count: number }>;
    totals: Array<{ event_name: string; count: number }>;
  };
  error?: string;
}

/**
 * Retrieves an aggregate summary of analytics events for the given number of days.
 * Bounds days to 1-365. Handles empty results and database failures safely.
 *
 * @param days - Number of days to include in the summary
 * @param neonClient - Neon SQL client (mockable for tests)
 */
export async function getAnalyticsSummary(
  days: number,
  neonClient: { sql: (...args: any[]) => Promise<any[]> }
): Promise<AnalyticsSummaryResult> {
  // Bound days to valid range
  const boundedDays = Math.min(Math.max(Math.round(days) || 1, 1), 365);

  try {
    const daily = await neonClient.sql`
      SELECT
        event_name,
        DATE(created_at) AS day,
        COUNT(*)::int AS count
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * ${boundedDays}
      GROUP BY event_name, DATE(created_at)
      ORDER BY day DESC, event_name
    `;

    const totals = await neonClient.sql`
      SELECT
        event_name,
        COUNT(*)::int AS count
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '1 day' * ${boundedDays}
      GROUP BY event_name
      ORDER BY count DESC
    `;

    return {
      success: true,
      data: {
        daily: daily as Array<{ day: string; event_name: string; count: number }>,
        totals: totals as Array<{ event_name: string; count: number }>,
      },
    };
  } catch (error: unknown) {
    // Sanitized error — no SQL, no connection strings, no stack traces
    const safeMessage =
      error instanceof Error ? error.message : String(error);
    const sanitizedMessage = safeMessage
      .replace(/postgres(ql)?:\/\/[^\s]+/gi, "[REDACTED]")
      .replace(/DATABASE_URL[^\s]*/gi, "[REDACTED]");

    return {
      success: false,
      error: `Analytics summary query failed: ${
        sanitizedMessage.length > 200
          ? sanitizedMessage.slice(0, 200)
          : sanitizedMessage
      }`,
    };
  }
}
