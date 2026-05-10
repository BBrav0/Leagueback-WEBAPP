/**
 * Browser-side analytics client for Leagueback.
 *
 * Manages anonymous visitor/session IDs, sends privacy-light analytics
 * events to the server ingestion endpoint, and never breaks UX if
 * ingestion fails (fail-open).
 *
 * Privacy guarantees:
 * - No raw secrets, API keys, database URLs
 * - No raw Riot IDs, PUUIDs, summoner IDs
 * - No cookies, auth headers
 * - Route paths containing player identifiers are sanitized
 * - Event properties are filtered for secret-like keys
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VISITOR_ID_KEY = "lb_visitor_id";
const SESSION_ID_KEY = "lb_session_id";
const INGEST_ENDPOINT = "/api/analytics/ingest";

/** Visitor ID format: must match server-side validation (alphanumeric, dash, underscore, 8-64 chars). */
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const ID_LENGTH = 24;

/** Approved failure categories for lookup_failure events. */
const APPROVED_FAILURE_CATEGORIES = new Set([
  "account_not_found",
  "match_data_unavailable",
  "rate_limited",
  "server_error",
  "network_error",
  "validation_error",
  "unknown",
]);

/** Approved client error categories. */
const APPROVED_CLIENT_ERROR_CATEGORIES = new Set([
  "fetch_failure",
  "parse_error",
  "validation_error",
  "unknown",
]);

/** Patterns indicating secret-like values that must be scrubbed from client payloads. */
const SECRET_KEY_PATTERNS = [
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
  /puuid/i,
  /summoner/i,
  /riot/i,
  /game[_-]?name/i,
  /tag[_-]?line/i,
];

/** Maximum string length for property values sent from client. */
const MAX_CLIENT_PROP_LENGTH = 256;

/** Browser event names allowed from the client. */
export const BROWSER_EVENT_NAMES = [
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
] as const;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  const chars = new Uint8Array(ID_LENGTH);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(chars);
  } else {
    // Fallback (shouldn't happen in modern browsers)
    for (let i = 0; i < ID_LENGTH; i++) {
      chars[i] = Math.floor(Math.random() * ID_CHARS.length);
    }
  }
  return Array.from(chars, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

// ---------------------------------------------------------------------------
// Visitor / session management
// ---------------------------------------------------------------------------

let _visitorId: string | null = null;
let _sessionId: string | null = null;

/**
 * Initializes or restores the analytics session.
 * - Visitor ID persists across sessions (localStorage)
 * - Session ID is regenerated each call
 */
export function initAnalyticsSession(): void {
  // Restore or create visitor ID
  if (!_visitorId) {
    try {
      const stored = localStorage.getItem(VISITOR_ID_KEY);
      if (stored && /^[a-zA-Z0-9_-]{8,64}$/.test(stored)) {
        _visitorId = stored;
      }
    } catch {
      // localStorage unavailable (SSR, incognito, etc.)
    }
  }

  if (!_visitorId) {
    _visitorId = generateId();
    try {
      localStorage.setItem(VISITOR_ID_KEY, _visitorId);
    } catch {
      // Silently ignore storage failures
    }
  }

  // Always generate a new session ID
  _sessionId = generateId();
}

/** Gets the current visitor ID (initializes if needed). */
export function getVisitorId(): string {
  if (!_visitorId) initAnalyticsSession();
  return _visitorId!;
}

/** Gets the current session ID (initializes if needed). */
export function getSessionId(): string {
  if (!_sessionId) initAnalyticsSession();
  return _sessionId!;
}

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function truncateValue(value: string): string {
  return value.length > MAX_CLIENT_PROP_LENGTH
    ? value.slice(0, MAX_CLIENT_PROP_LENGTH)
    : value;
}

/**
 * Scrubs properties of secret-like keys, raw identifiers, and oversized values.
 */
function scrubProperties(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSecretKey(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      result[key] = truncateValue(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
    // Ignore objects, arrays, functions, etc.
  }
  return result;
}

/**
 * Simple client-side hash for Riot identifiers.
 * NOT cryptographically secure — just ensures raw identifiers
 * are not sent to the server in cleartext from the client.
 * The server will apply proper keyed hashing.
 */
function clientHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Convert to hex-style string
  return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Route path sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitizes a route path to remove player-identifying segments and query strings.
 */
export function sanitizeClientPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") return "/";

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
// Referrer / client context helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a coarse referrer category from document.referrer.
 * Returns one of: 'direct', 'internal', 'external', or 'unknown'.
 */
function getReferrerCategory(): string {
  try {
    if (typeof document === 'undefined') return 'unknown';
    const ref = document.referrer;
    if (!ref) return 'direct';
    const refUrl = new URL(ref);
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
    if (refUrl.hostname === currentHost) return 'internal';
    return 'external';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Core event tracking
// ---------------------------------------------------------------------------

/**
 * Sends an analytics event to the ingestion endpoint.
 * Always resolves (never rejects) — analytics failures are non-blocking.
 */
export async function trackEvent(
  eventName: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    const visitorId = getVisitorId();
    const sessionId = getSessionId();

    // Scrub properties for privacy
    const scrubbedProps = scrubProperties(properties);

    await fetch(INGEST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        visitorId,
        sessionId,
        properties: scrubbedProps,
      }),
    });
  } catch {
    // Fail-open: analytics ingestion failure must never break UX
  }
}

// ---------------------------------------------------------------------------
// Convenience event functions
// ---------------------------------------------------------------------------

/** Tracks a page view with sanitized route path, referrer category. */
export async function trackPageView(path: string): Promise<void> {
  await trackEvent("page_view", {
    page: sanitizeClientPath(path),
    referrer: getReferrerCategory(),
  });
}

/** Tracks a player page view with sanitized route path, referrer category. */
export async function trackPlayerPageView(path: string): Promise<void> {
  await trackEvent("player_page_view", {
    page: sanitizeClientPath(path),
    referrer: getReferrerCategory(),
  });
}

/** Tracks a search attempt without raw Riot IDs. */
export async function trackSearchAttempt(
  gameName: string,
  tagLine: string
): Promise<void> {
  const queryHash = clientHash(`${gameName.toLowerCase()}#${tagLine.toLowerCase()}`);
  await trackEvent("search_attempt", {
    queryHash,
    hasTagLine: !!tagLine,
  });
}

/** Tracks a successful lookup with high-level result metadata. */
export async function trackLookupSuccess(metadata: {
  matchCount: number;
}): Promise<void> {
  await trackEvent("lookup_success", {
    matchCount: metadata.matchCount,
  });
}

/** Tracks a failed lookup with bounded failure category. */
export async function trackLookupFailure(
  category: string,
  _rawMessage?: string
): Promise<void> {
  // Bound to approved categories
  const safeCategory = APPROVED_FAILURE_CATEGORIES.has(category)
    ? category
    : "unknown";

  await trackEvent("lookup_failure", {
    failureCategory: safeCategory,
  });
}

/** Tracks a match detail view with a non-PII match reference. */
export async function trackMatchDetailView(matchId: string): Promise<void> {
  // Hash the match ID to avoid sending raw identifiers
  const matchRef = clientHash(matchId);
  await trackEvent("match_detail_view", {
    matchRef,
  });
}

/** Tracks a load-more/pagination action with bounded context. */
export async function trackLoadMore(context: {
  offset: number;
  limit: number;
  source: string;
}): Promise<void> {
  await trackEvent("load_more", {
    offset: context.offset,
    limit: context.limit,
    source: truncateValue(context.source),
  });
}

/** Tracks a manual update action with bounded outcome. */
export async function trackManualUpdate(context: {
  outcome: string;
}): Promise<void> {
  await trackEvent("manual_update", {
    outcome: truncateValue(context.outcome),
  });
}

/** Tracks a client-side error with sanitized category and context. */
export async function trackClientError(
  category: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  const safeCategory = APPROVED_CLIENT_ERROR_CATEGORIES.has(category)
    ? category
    : "unknown";

  // Sanitize route paths in context
  const sanitizedContext: Record<string, unknown> = {};
  if (context.route && typeof context.route === "string") {
    sanitizedContext.route = sanitizeClientPath(context.route);
  }
  // Do NOT forward raw error messages or stack traces

  await trackEvent("client_error", {
    category: safeCategory,
    ...sanitizedContext,
  });
}
