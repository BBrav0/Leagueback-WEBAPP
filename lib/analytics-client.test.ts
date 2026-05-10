/**
 * Tests for the browser-side analytics client.
 *
 * Covers:
 * - Visitor/session ID generation (format, persistence, uniqueness)
 * - Event sending (fail-open, payload structure, privacy)
 * - Session lifecycle (page view dedup, timeout/renewal)
 * - Privacy constraints (no raw secrets, Riot IDs, PUUIDs, cookies)
 * - Route path sanitization on the client side
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

// --- Mock localStorage ---
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  }),
  get length() {
    return Object.keys(localStorageStore).length;
  },
  key: vi.fn((index: number) => Object.keys(localStorageStore)[index] ?? null),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// --- Mock document.referrer ---
let mockReferrer = "";
Object.defineProperty(globalThis, "document", {
  value: {
    get referrer() { return mockReferrer; },
  },
  writable: true,
  configurable: true,
});

// --- Mock window.location ---
let mockHostname = "localhost";
Object.defineProperty(globalThis, "window", {
  value: {
    location: {
      get hostname() { return mockHostname; },
      href: "http://localhost:3005/",
      pathname: "/",
      hash: "",
    },
  },
  writable: true,
  configurable: true,
});


// --- Mock fetch ---

const mockFetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
Object.defineProperty(globalThis, "fetch", { value: mockFetch, writable: true });

// Helper for typed mock fetch call access
interface MockFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
function getCallArgs(index: number): MockFetchCall {
  const call = mockFetch.mock.calls[index] as unknown as [string, RequestInit];
  const opts = call[1];
  return {
    url: call[0],
    method: opts.method ?? "GET",
    headers: (opts.headers ?? {}) as Record<string, string>,
    body: opts.body as string ?? "{}",
  };
}

// --- Mock location ---
const originalLocation = { href: "http://localhost:3005/" };

// --- Mock crypto.randomUUID ---
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

// Import after mocks are set up
import {
  initAnalyticsSession,
  getVisitorId,
  getSessionId,
  trackEvent,
  trackPageView,
  trackPlayerPageView,
  trackSearchAttempt,
  trackLookupSuccess,
  trackLookupFailure,
  trackMatchDetailView,
  trackLoadMore,
  trackManualUpdate,
  trackClientError,
  sanitizeClientPath,
  BROWSER_EVENT_NAMES,
} from "./analytics-client";

beforeEach(() => {
  // Clear all state
  Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  mockFetch.mockClear();
  uuidCounter = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Visitor/session ID generation
// ---------------------------------------------------------------------------

describe("visitor and session IDs", () => {
  it("generates a visitor ID in the expected format on first init", () => {
    initAnalyticsSession();
    const visitorId = getVisitorId();
    expect(visitorId).toBeTruthy();
    // Must match server validation: alphanumeric, dash, underscore, 8-64 chars
    expect(visitorId).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
  });

  it("generates a session ID in the expected format on init", () => {
    initAnalyticsSession();
    const sessionId = getSessionId();
    expect(sessionId).toBeTruthy();
    expect(sessionId).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
  });

  it("persists visitor ID across sessions", () => {
    initAnalyticsSession();
    const firstVisitorId = getVisitorId();

    // Re-init (simulates new page load)
    initAnalyticsSession();
    const secondVisitorId = getVisitorId();

    expect(firstVisitorId).toBe(secondVisitorId);
  });

  it("generates a new session ID on each init call", () => {
    initAnalyticsSession();
    const firstSessionId = getSessionId();

    initAnalyticsSession();
    const secondSessionId = getSessionId();

    expect(firstSessionId).not.toBe(secondSessionId);
  });

  it("does not call fetch during init (visitor_activity is tracked via trackPageView)", () => {
    initAnalyticsSession();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Event tracking (fail-open)
// ---------------------------------------------------------------------------

describe("trackEvent", () => {
  it("sends a POST to /api/analytics/ingest with the correct payload shape", async () => {
    initAnalyticsSession();
    await trackEvent("page_view", { page: "/" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call0 = getCallArgs(0);
    expect(call0.url).toBe("/api/analytics/ingest");
    expect(call0.method).toBe("POST");
    expect(call0.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(call0.body);
    expect(body.eventName).toBe("page_view");
    expect(body.visitorId).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
    expect(body.sessionId).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
    expect(body.properties.page).toBe("/");
  });

  it("does not throw when fetch fails (fail-open)", async () => {
    initAnalyticsSession();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    // Should not throw
    await expect(
      trackEvent("page_view", { page: "/" })
    ).resolves.toBeUndefined();
  });

  it("does not throw when server returns 500 (fail-open)", async () => {
    initAnalyticsSession();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Internal error" }), { status: 500 })
    );

    await expect(
      trackEvent("page_view", { page: "/" })
    ).resolves.toBeUndefined();
  });

  it("never sends raw secrets, API keys, or database URLs in properties", async () => {
    initAnalyticsSession();
    await trackEvent("page_view", {
      page: "/",
      // These should be stripped before sending
      apiKey: "super-secret",
      database_url: "postgres://...",
      token: "abc123",
      password: "hunter2",
    });

    const body = JSON.parse(getCallArgs(0).body);
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("super-secret");
    expect(bodyStr).not.toContain("postgres");
    expect(bodyStr).not.toContain("abc123");
    expect(bodyStr).not.toContain("hunter2");
    // Secret keys should be stripped entirely
    expect(body.properties).not.toHaveProperty("apiKey");
    expect(body.properties).not.toHaveProperty("database_url");
    expect(body.properties).not.toHaveProperty("token");
    expect(body.properties).not.toHaveProperty("password");
  });

  it("never sends raw Riot IDs, PUUIDs, or auth headers in properties", async () => {
    initAnalyticsSession();
    await trackEvent("search_attempt", {
      rawRiotId: "PlayerName#EUW1",
      puuid: "abc-def-123-456-puuid",
      authorization: "Bearer some-token",
      cookie: "session=abc123",
    });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties).not.toHaveProperty("rawRiotId");
    expect(body.properties).not.toHaveProperty("puuid");
    expect(body.properties).not.toHaveProperty("authorization");
    expect(body.properties).not.toHaveProperty("cookie");
  });
});

// ---------------------------------------------------------------------------
// Convenience event functions
// ---------------------------------------------------------------------------

describe("trackPageView", () => {
  it("sends a page_view event with sanitized route path and referrer", async () => {
    initAnalyticsSession();
    mockReferrer = "";
    await trackPageView("/player/SomeRiotName/EUW1");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("page_view");
    // Player paths should be sanitized
    expect(body.properties.page).toBe("/player");
    expect(body.properties.page).not.toContain("SomeRiotName");
    // Referrer category should be present
    expect(body.properties).toHaveProperty("referrer");
    expect(["direct", "internal", "external", "unknown"]).toContain(body.properties.referrer);
  });

  it("sends a page_view event with homepage path intact and referrer", async () => {
    initAnalyticsSession();
    mockReferrer = "";
    await trackPageView("/");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("page_view");
    expect(body.properties.page).toBe("/");
    expect(body.properties.referrer).toBe("direct");
  });

  it("categorizes external referrer correctly", async () => {
    initAnalyticsSession();
    mockReferrer = "https://google.com/search";
    await trackPageView("/");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.referrer).toBe("external");
  });

  it("categorizes internal referrer correctly", async () => {
    initAnalyticsSession();
    mockReferrer = "http://localhost:3005/player";
    await trackPageView("/");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.referrer).toBe("internal");
  });
});

describe("trackSearchAttempt", () => {
  it("sends a search_attempt event without raw Riot ID", async () => {
    initAnalyticsSession();
    await trackSearchAttempt("SomePlayer", "EUW1");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("search_attempt");
    const bodyStr = JSON.stringify(body);
    // Must not contain raw Riot ID
    expect(bodyStr).not.toContain("SomePlayer");
    expect(bodyStr).not.toContain("EUW1");
    // Should have a hash or indicator instead
    expect(body.properties).toHaveProperty("queryHash");
    expect(body.properties.queryHash).toBeTruthy();
  });
});

describe("trackLookupSuccess", () => {
  it("sends a lookup_success event with result metadata but no raw PUUID", async () => {
    initAnalyticsSession();
    await trackLookupSuccess({ matchCount: 5 });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("lookup_success");
    expect(body.properties.matchCount).toBe(5);
    expect(body.properties).not.toHaveProperty("puuid");
    expect(body.properties).not.toHaveProperty("gameName");
  });
});

describe("trackLookupFailure", () => {
  it("sends a lookup_failure event with bounded failure category", async () => {
    initAnalyticsSession();
    await trackLookupFailure("account_not_found");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("lookup_failure");
    expect(body.properties.failureCategory).toBe("account_not_found");
  });

  it("bounds failure category to approved values", async () => {
    initAnalyticsSession();
    await trackLookupFailure("some_long_raw_error_message_that_should_be_bounded");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.failureCategory).toBe("unknown");
  });

  it("does not send raw error messages", async () => {
    initAnalyticsSession();
    await trackLookupFailure("account_not_found", "Long raw exception message with stack trace");

    const bodyStr = JSON.stringify(getCallArgs(0).body);
    expect(bodyStr).not.toContain("Long raw exception message");
    expect(bodyStr).not.toContain("stack trace");
  });
});

describe("trackMatchDetailView", () => {
  it("sends a match_detail_view event with sanitized match reference", async () => {
    initAnalyticsSession();
    await trackMatchDetailView("NA1_1234567890");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("match_detail_view");
    expect(body.properties).toHaveProperty("matchRef");
    // The raw match ID should be hashed/scrubbed
    expect(body.properties.matchRef).not.toBe("NA1_1234567890");
  });
});

describe("trackLoadMore", () => {
  it("sends a load_more event with bounded pagination context", async () => {
    initAnalyticsSession();
    await trackLoadMore({ offset: 20, limit: 20, source: "stored-history" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("load_more");
    expect(body.properties.offset).toBe(20);
    expect(body.properties.limit).toBe(20);
    expect(body.properties.source).toBe("stored-history");
  });
});

describe("trackManualUpdate", () => {
  it("sends a manual_update event", async () => {
    initAnalyticsSession();
    await trackManualUpdate({ outcome: "success" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("manual_update");
    expect(body.properties.outcome).toBe("success");
  });

  it("tracks rate-limited outcome", async () => {
    initAnalyticsSession();
    await trackManualUpdate({ outcome: "rate_limited" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.outcome).toBe("rate_limited");
  });
});

describe("trackClientError", () => {
  it("sends a client_error event with sanitized category", async () => {
    initAnalyticsSession();
    await trackClientError("fetch_failure", { route: "/api/match-performance" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("client_error");
    expect(body.properties.category).toBe("fetch_failure");
    // Route should be sanitized (no raw player paths)
    expect(body.properties.route).toBe("/api/match-performance");
  });

  it("does not send raw error messages or stack traces", async () => {
    initAnalyticsSession();
    await trackClientError("fetch_failure", {
      error: new Error("TypeError: Cannot read properties of undefined (reading 'puuid')\n    at Component (dashboard.tsx:123)").message,
    });

    const bodyStr = JSON.stringify(getCallArgs(0).body);
    expect(bodyStr).not.toContain("TypeError");
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("puuid");
  });
});

// ---------------------------------------------------------------------------
// Route path sanitization
// ---------------------------------------------------------------------------

describe("sanitizeClientPath", () => {
  it("strips player-identifying segments from /player/ paths", () => {
    expect(sanitizeClientPath("/player/SomeName/EUW1")).toBe("/player");
    expect(sanitizeClientPath("/player/SomeName#EUW1")).toBe("/player");
  });

  it("preserves generic paths", () => {
    expect(sanitizeClientPath("/")).toBe("/");
    expect(sanitizeClientPath("/dashboard")).toBe("/dashboard");
  });

  it("strips query strings", () => {
    expect(sanitizeClientPath("/?foo=bar")).toBe("/");
    expect(sanitizeClientPath("/player/X?tab=overview")).toBe("/player");
  });

  it("strips hash fragments", () => {
    expect(sanitizeClientPath("/#EUW1")).toBe("/");
    expect(sanitizeClientPath("/player/X#EUW1")).toBe("/player");
  });
});

// ---------------------------------------------------------------------------
// Browser event names
// ---------------------------------------------------------------------------

describe("BROWSER_EVENT_NAMES", () => {
  it("includes all expected browser event names", () => {
    expect(BROWSER_EVENT_NAMES).toContain("page_view");
    expect(BROWSER_EVENT_NAMES).toContain("search_attempt");
    expect(BROWSER_EVENT_NAMES).toContain("lookup_success");
    expect(BROWSER_EVENT_NAMES).toContain("lookup_failure");
    expect(BROWSER_EVENT_NAMES).toContain("player_page_view");
    expect(BROWSER_EVENT_NAMES).toContain("match_detail_view");
    expect(BROWSER_EVENT_NAMES).toContain("load_more");
    expect(BROWSER_EVENT_NAMES).toContain("manual_update");
    expect(BROWSER_EVENT_NAMES).toContain("client_error");
  });
});

// ---------------------------------------------------------------------------
// Session context consistency
// ---------------------------------------------------------------------------

describe("session context consistency", () => {
  it("all events in a flow share the same visitor and session IDs", async () => {
    initAnalyticsSession();
    const visitorId = getVisitorId();
    const sessionId = getSessionId();

    await trackPageView("/");
    await trackSearchAttempt("Player", "EUW1");
    await trackLookupSuccess({ matchCount: 3 });
    await trackMatchDetailView("NA1_1234567890");

    expect(mockFetch).toHaveBeenCalledTimes(4);
    for (let i = 0; i < mockFetch.mock.calls.length; i++) {
      const call = getCallArgs(i);
      const body = JSON.parse(call.body);
      expect(body.visitorId).toBe(visitorId);
      expect(body.sessionId).toBe(sessionId);
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-SEC-004: Client-facing code exposes no server-only secrets
// ---------------------------------------------------------------------------

describe("VAL-SEC-004: client module exports no server secrets", () => {
  it("does not export any secret-like values or server-only identifiers", async () => {
    // Import the module namespace and verify no secret exports
    const mod = await import("./analytics-client");
    const exportKeys = Object.keys(mod);

    // Should not contain server-only values
    for (const key of exportKeys) {
      expect(key.toLowerCase()).not.toContain("secret");
      expect(key.toLowerCase()).not.toContain("apikey");
      expect(key.toLowerCase()).not.toContain("hmac");
      expect(key.toLowerCase()).not.toContain("database");
      expect(key.toLowerCase()).not.toContain("connection");
    }

    // Verify no secret-like string values in exports
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === "string") {
        expect(value).not.toMatch(/postgres(ql)?:\/\//i);
        expect(value).not.toMatch(/sk_live|sk_test/i);
        expect(value).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
        expect(value).not.toMatch(/Bearer\s+/i);
      }
    }
  });

  it("INGEST_ENDPOINT is a relative first-party path, not an external URL", async () => {
    const mod = await import("./analytics-client");
    // INGEST_ENDPOINT is not exported, but trackEvent only uses /api/analytics/ingest
    initAnalyticsSession();
    await trackEvent("page_view", { page: "/" });
    const call = getCallArgs(mockFetch.mock.calls.length - 1);
    expect(call.url).toBe("/api/analytics/ingest");
    expect(call.url).not.toMatch(/^https?:\/\//);
    expect(call.url).not.toMatch(/google-analytics|segment|mixpanel|amplitude|datadog/i);
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-001: Browser analytics posts only to first-party ingest
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-001: all convenience functions post to first-party ingest", () => {
  it("every track* function targets /api/analytics/ingest via POST with JSON", async () => {
    initAnalyticsSession();
    mockReferrer = "";

    // Fire all convenience functions
    await trackPageView("/");
    await trackSearchAttempt("Player", "EUW1");
    await trackLookupSuccess({ matchCount: 5 });
    await trackLookupFailure("account_not_found");
    await trackMatchDetailView("NA1_1234567890");
    await trackLoadMore({ offset: 0, limit: 20, source: "stored-history" });
    await trackManualUpdate({ outcome: "success" });
    await trackClientError("fetch_failure", { route: "/api/test" });

    // Every call must target the same first-party endpoint
    expect(mockFetch).toHaveBeenCalledTimes(8);
    for (let i = 0; i < mockFetch.mock.calls.length; i++) {
      const call = getCallArgs(i);
      expect(call.url).toBe("/api/analytics/ingest");
      expect(call.method).toBe("POST");
      expect(call.headers["Content-Type"]).toBe("application/json");
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-002: Client payload shape is minimal
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-002: payload contains only the four required top-level fields", () => {
  it("every event has exactly eventName, visitorId, sessionId, and properties at top level", async () => {
    initAnalyticsSession();
    await trackEvent("page_view", { page: "/" });

    const body = JSON.parse(getCallArgs(0).body);
    const topKeys = Object.keys(body).sort();
    expect(topKeys).toEqual(["eventName", "properties", "sessionId", "visitorId"]);
  });

  it("does not add extra top-level fields like timestamp, userAgent, or screen", async () => {
    initAnalyticsSession();
    await trackSearchAttempt("Player", "EUW1");

    const body = JSON.parse(getCallArgs(0).body);
    const topKeys = Object.keys(body);
    expect(topKeys).toHaveLength(4);
    expect(topKeys).not.toContain("timestamp");
    expect(topKeys).not.toContain("userAgent");
    expect(topKeys).not.toContain("screen");
    expect(topKeys).not.toContain("ip");
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-003: Search and lookup events are privacy-safe
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-003: search and lookup events never expose raw identifiers", () => {
  it("search_attempt payload has no raw game name or tag line anywhere in body", async () => {
    initAnalyticsSession();
    await trackSearchAttempt("VerySecretPlayer", "EUW1");

    const bodyStr = getCallArgs(0).body;
    // Parse to check structure
    const body = JSON.parse(bodyStr);
    expect(body.eventName).toBe("search_attempt");

    // Raw identifiers must not appear anywhere in the serialized body
    expect(bodyStr).not.toContain("VerySecretPlayer");
    expect(bodyStr).not.toContain("EUW1");
    // Must have the hashed query identifier
    expect(body.properties).toHaveProperty("queryHash");
    expect(typeof body.properties.queryHash).toBe("string");
    expect(body.properties.queryHash.length).toBeGreaterThan(0);
  });

  it("search_attempt preserves hasTagLine boolean indicator", async () => {
    initAnalyticsSession();
    await trackSearchAttempt("Player", "EUW1");
    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.hasTagLine).toBe(true);

    mockFetch.mockClear();
    await trackSearchAttempt("Player", "");
    const body2 = JSON.parse(getCallArgs(0).body);
    expect(body2.properties.hasTagLine).toBe(false);
  });

  it("lookup_success contains only matchCount, no identifiers", async () => {
    initAnalyticsSession();
    await trackLookupSuccess({ matchCount: 42 });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("lookup_success");
    expect(body.properties.matchCount).toBe(42);
    const propKeys = Object.keys(body.properties);
    expect(propKeys).toEqual(["matchCount"]);
  });

  it("lookup_failure contains only bounded failureCategory", async () => {
    initAnalyticsSession();
    await trackLookupFailure("account_not_found", "Detailed error with Riot API response for player X");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("lookup_failure");
    const bodyStr = JSON.stringify(body);
    expect(body.properties.failureCategory).toBe("account_not_found");
    // Raw error message must not appear
    expect(bodyStr).not.toContain("Detailed error");
    expect(bodyStr).not.toContain("Riot API response");
    expect(bodyStr).not.toContain("player X");
  });

  it("lookup_failure maps unknown categories to 'unknown'", async () => {
    initAnalyticsSession();
    await trackLookupFailure("custom_category_with_details");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.failureCategory).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-004: Route and referrer tracking is sanitized
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-004: route and referrer tracking sanitization", () => {
  it("page_view strips query strings containing potential identifiers", async () => {
    initAnalyticsSession();
    await trackPageView("/?gameName=SecretPlayer&tagLine=EUW1");

    const body = JSON.parse(getCallArgs(0).body);
    const bodyStr = JSON.stringify(body);
    expect(body.properties.page).toBe("/");
    expect(bodyStr).not.toContain("SecretPlayer");
    expect(bodyStr).not.toContain("tagLine");
  });

  it("player_page_view normalizes all player path variants", async () => {
    initAnalyticsSession();

    // Various player URL shapes
    const playerPaths = [
      "/player/SomeGameName",
      "/player/SomeGameName/EUW1",
      "/player/SomeGameName#EUW1",
      "/player/SomeGameName?region=EUW",
      "/player/SomeGameName/EUW1?tab=overview",
      "/player/SomeGameName#tag?extra=data",
    ];

    for (const path of playerPaths) {
      mockFetch.mockClear();
      await trackPlayerPageView(path);
      const body = JSON.parse(getCallArgs(0).body);
      expect(body.properties.page).toBe("/player");
    }
  });

  it("page_view referrer category is bounded to known values", async () => {
    initAnalyticsSession();

    const refCases = [
      { referrer: "", expected: "direct" },
      { referrer: "http://localhost:3005/", expected: "internal" },
      { referrer: "https://google.com/", expected: "external" },
    ];

    for (const { referrer, expected } of refCases) {
      mockReferrer = referrer;
      mockFetch.mockClear();
      await trackPageView("/");
      const body = JSON.parse(getCallArgs(0).body);
      expect(["direct", "internal", "external", "unknown"]).toContain(body.properties.referrer);
    }
  });

  it("sanitizeClientPath handles hash fragments with tag line content", () => {
    // VAL-CLIENT-009: Various tagline encoding patterns
    expect(sanitizeClientPath("/player/GameName#EUW1")).toBe("/player");
    expect(sanitizeClientPath("/player/GameName#1234")).toBe("/player");
    expect(sanitizeClientPath("/player/GameName#tag")).toBe("/player");
  });

  it("sanitizeClientPath handles URL-encoded player names", () => {
    expect(sanitizeClientPath("/player/Player%20Name")).toBe("/player");
    expect(sanitizeClientPath("/player/Player%23Name/EUW1")).toBe("/player");
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-005: Match, load-more, and manual update events are privacy-safe
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-005: match/load-more/manual-update events never expose raw identifiers", () => {
  it("match_detail_view hashes match ID, never sends raw match ID", async () => {
    initAnalyticsSession();
    await trackMatchDetailView("NA1_9999999999");

    const body = JSON.parse(getCallArgs(0).body);
    const bodyStr = JSON.stringify(body);
    expect(body.eventName).toBe("match_detail_view");
    // Raw match ID must not appear
    expect(bodyStr).not.toContain("NA1_9999999999");
    // Should have a hashed reference
    expect(body.properties.matchRef).toBeTruthy();
    expect(typeof body.properties.matchRef).toBe("string");
    expect(body.properties.matchRef).not.toBe("NA1_9999999999");
  });

  it("match_detail_view matchRef is a one-way transformation", async () => {
    initAnalyticsSession();
    await trackMatchDetailView("NA1_12345");
    const ref1 = JSON.parse(getCallArgs(0).body).properties.matchRef;

    // Same input produces same hash (deterministic)
    mockFetch.mockClear();
    await trackMatchDetailView("NA1_12345");
    const ref2 = JSON.parse(getCallArgs(0).body).properties.matchRef;
    expect(ref1).toBe(ref2);

    // Different input produces different hash
    mockFetch.mockClear();
    await trackMatchDetailView("NA1_99999");
    const ref3 = JSON.parse(getCallArgs(0).body).properties.matchRef;
    expect(ref3).not.toBe(ref1);
  });

  it("load_more contains only offset, limit, source — no raw identifiers", async () => {
    initAnalyticsSession();
    await trackLoadMore({ offset: 40, limit: 20, source: "riot-api" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("load_more");
    expect(body.properties).toEqual({
      offset: 40,
      limit: 20,
      source: "riot-api",
    });
  });

  it("manual_update contains only bounded outcome", async () => {
    initAnalyticsSession();

    const outcomes = ["success", "rate_limited", "error"];
    for (const outcome of outcomes) {
      mockFetch.mockClear();
      await trackManualUpdate({ outcome });
      const body = JSON.parse(getCallArgs(0).body);
      expect(body.eventName).toBe("manual_update");
      expect(body.properties.outcome).toBe(outcome);
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-006: Client error analytics are bounded
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-006: client errors contain no raw details", () => {
  it("client_error drops raw error messages and stack traces from context", async () => {
    initAnalyticsSession();
    await trackClientError("fetch_failure", {
      message: "TypeError: Cannot read property 'puuid' of undefined",
      stack: "TypeError: Cannot read...\n    at dashboard.tsx:123\n    at React._render",
    });

    const body = JSON.parse(getCallArgs(0).body);
    const bodyStr = JSON.stringify(body);
    expect(body.eventName).toBe("client_error");
    expect(body.properties.category).toBe("fetch_failure");
    // Raw message and stack must not appear
    expect(bodyStr).not.toContain("TypeError");
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("puuid");
    expect(bodyStr).not.toContain("dashboard.tsx");
  });

  it("client_error bounds category to approved values", async () => {
    initAnalyticsSession();
    await trackClientError("custom_category");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.properties.category).toBe("unknown");
  });

  it("client_error sanitizes route paths in context", async () => {
    initAnalyticsSession();
    await trackClientError("fetch_failure", {
      route: "/player/SecretPlayer/EUW1",
    });

    const body = JSON.parse(getCallArgs(0).body);
    const bodyStr = JSON.stringify(body);
    expect(body.properties.route).toBe("/player");
    expect(bodyStr).not.toContain("SecretPlayer");
  });

  it("client_error does not forward cookie or auth headers in context", async () => {
    initAnalyticsSession();
    await trackClientError("fetch_failure", {
      cookie: "session=abc123",
      authorization: "Bearer token123",
      apiKey: "secret-key",
    });

    const body = JSON.parse(getCallArgs(0).body);
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("session=abc123");
    expect(bodyStr).not.toContain("Bearer");
    expect(bodyStr).not.toContain("secret-key");
    expect(body.properties).not.toHaveProperty("cookie");
    expect(body.properties).not.toHaveProperty("authorization");
    expect(body.properties).not.toHaveProperty("apiKey");
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-007: Client analytics fails open
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-007: analytics failures do not block UX", () => {
  it("all convenience functions resolve without throwing when fetch rejects", async () => {
    initAnalyticsSession();
    mockFetch.mockRejectedValue(new Error("Network down"));

    // None of these should throw
    await expect(trackPageView("/")).resolves.toBeUndefined();
    await expect(trackSearchAttempt("P", "T")).resolves.toBeUndefined();
    await expect(trackLookupSuccess({ matchCount: 1 })).resolves.toBeUndefined();
    await expect(trackLookupFailure("error")).resolves.toBeUndefined();
    await expect(trackMatchDetailView("NA1_123")).resolves.toBeUndefined();
    await expect(trackLoadMore({ offset: 0, limit: 20, source: "test" })).resolves.toBeUndefined();
    await expect(trackManualUpdate({ outcome: "success" })).resolves.toBeUndefined();
    await expect(trackClientError("fetch_failure")).resolves.toBeUndefined();
  });

  it("all convenience functions resolve when server returns 500", async () => {
    initAnalyticsSession();
    mockFetch.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    await expect(trackPageView("/")).resolves.toBeUndefined();
    await expect(trackSearchAttempt("P", "T")).resolves.toBeUndefined();
    await expect(trackLookupSuccess({ matchCount: 1 })).resolves.toBeUndefined();
  });

  it("all convenience functions resolve when server returns 429 (rate limited)", async () => {
    initAnalyticsSession();
    mockFetch.mockResolvedValue(new Response("Too Many Requests", { status: 429 }));

    await expect(trackPageView("/")).resolves.toBeUndefined();
    await expect(trackClientError("fetch_failure")).resolves.toBeUndefined();
  });

  it("trackEvent never creates unhandled promise rejections on fetch failure", async () => {
    initAnalyticsSession();
    mockFetch.mockRejectedValue(new Error("Network error"));

    // Call without awaiting — should not create unhandled rejection
    trackEvent("page_view", { page: "/" });

    // Give microtask queue a chance
    await new Promise((r) => setTimeout(r, 50));

    // If we get here without unhandled rejection, the test passes
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-008: Dashboard user interactions emit expected analytics
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-008: each interaction type emits the correct sanitized event", () => {
  it("search submit emits search_attempt with hashed query", async () => {
    initAnalyticsSession();
    // Simulates what onSearchAttempt does
    const gameName = "TestPlayer";
    const tagLine = "EUW1";

    // Simulate the hook calling trackSearchAttempt
    await trackSearchAttempt(gameName, tagLine);

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("search_attempt");
    expect(body.properties).toHaveProperty("queryHash");
    expect(body.properties).toHaveProperty("hasTagLine");
  });

  it("successful lookup emits lookup_success with matchCount", async () => {
    initAnalyticsSession();
    await trackLookupSuccess({ matchCount: 10 });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("lookup_success");
    expect(body.properties.matchCount).toBe(10);
  });

  it("failed lookup emits lookup_failure with bounded category", async () => {
    initAnalyticsSession();
    await trackLookupFailure("account_not_found");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("lookup_failure");
    expect(body.properties.failureCategory).toBe("account_not_found");
  });

  it("match card expansion emits match_detail_view with hashed matchRef", async () => {
    initAnalyticsSession();
    await trackMatchDetailView("NA1_1234567890");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("match_detail_view");
    expect(body.properties).toHaveProperty("matchRef");
    expect(body.properties.matchRef).not.toBe("NA1_1234567890");
  });

  it("stored-history load-more emits load_more with source=stored-history", async () => {
    initAnalyticsSession();
    await trackLoadMore({ offset: 20, limit: 20, source: "stored-history" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("load_more");
    expect(body.properties.source).toBe("stored-history");
    expect(body.properties.offset).toBe(20);
  });

  it("riot-api load-more emits load_more with source=riot-api", async () => {
    initAnalyticsSession();
    await trackLoadMore({ offset: 0, limit: 5, source: "riot-api" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("load_more");
    expect(body.properties.source).toBe("riot-api");
  });

  it("manual update success emits manual_update with outcome=success", async () => {
    initAnalyticsSession();
    await trackManualUpdate({ outcome: "success" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("manual_update");
    expect(body.properties.outcome).toBe("success");
  });

  it("manual update rate-limited emits manual_update with outcome=rate_limited", async () => {
    initAnalyticsSession();
    await trackManualUpdate({ outcome: "rate_limited" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("manual_update");
    expect(body.properties.outcome).toBe("rate_limited");
  });

  it("manual update error emits manual_update with outcome=error", async () => {
    initAnalyticsSession();
    await trackManualUpdate({ outcome: "error" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("manual_update");
    expect(body.properties.outcome).toBe("error");
  });

  it("client error emits client_error with sanitized category and route", async () => {
    initAnalyticsSession();
    await trackClientError("fetch_failure", { route: "/api/match-performance" });

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("client_error");
    expect(body.properties.category).toBe("fetch_failure");
    expect(body.properties.route).toBe("/api/match-performance");
  });

  it("page view on player route emits player_page_view not page_view", async () => {
    initAnalyticsSession();
    mockReferrer = "";

    // When sanitizeClientPath returns /player, trackPlayerPageView should fire
    await trackPlayerPageView("/player/TestPlayer/EUW1");

    const body = JSON.parse(getCallArgs(0).body);
    expect(body.eventName).toBe("player_page_view");
    expect(body.properties.page).toBe("/player");
  });
});

// ---------------------------------------------------------------------------
// VAL-CLIENT-009: Real player route shape is sanitized
// ---------------------------------------------------------------------------

describe("VAL-CLIENT-009: player URL shapes are sanitized correctly", () => {
  it("sanitizes /player/[gameName] (single segment)", () => {
    expect(sanitizeClientPath("/player/TestGameName")).toBe("/player");
  });

  it("sanitizes /player/[gameName]/[tagLine] (two segments)", () => {
    expect(sanitizeClientPath("/player/TestGameName/EUW1")).toBe("/player");
  });

  it("sanitizes /player/[gameName]#[tagLine] (hash variant)", () => {
    expect(sanitizeClientPath("/player/TestGameName#EUW1")).toBe("/player");
  });

  it("sanitizes /player/[gameName]?queryParams (query variant)", () => {
    expect(sanitizeClientPath("/player/TestGameName?tab=overview")).toBe("/player");
  });

  it("sanitizes /player/[gameName]/[tagLine]?queryParams (full variant)", () => {
    expect(sanitizeClientPath("/player/TestGameName/EUW1?refresh=true")).toBe("/player");
  });

  it("sanitizes URL-encoded game names", () => {
    expect(sanitizeClientPath("/player/Player%20Name")).toBe("/player");
    expect(sanitizeClientPath("/player/Player%23Name/EUW1")).toBe("/player");
  });

  it("strips query strings that might contain identifiers", () => {
    const result = sanitizeClientPath("/player/X?puuid=abc123&gameName=Secret");
    expect(result).toBe("/player");
  });

  it("preserves non-player routes intact", () => {
    expect(sanitizeClientPath("/")).toBe("/");
    expect(sanitizeClientPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeClientPath("/api/match-performance")).toBe("/api/match-performance");
  });

  it("handles edge cases gracefully", () => {
    expect(sanitizeClientPath("")).toBe("/");
    expect(sanitizeClientPath("/player/")).toBe("/player");
    expect(sanitizeClientPath("/player")).toBe("/player");
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-005: Identifier hashes are protected before persistence
// ---------------------------------------------------------------------------

describe("VAL-CROSS-005: client-derived hashes are non-reversible bounded references", () => {
  it("client-side queryHash is a bounded non-reversible reference (not raw identifier)", async () => {
    initAnalyticsSession();

    // Two different players should produce different hashes
    await trackSearchAttempt("PlayerA", "EUW1");
    const hash1 = JSON.parse(getCallArgs(0).body).properties.queryHash;

    mockFetch.mockClear();
    await trackSearchAttempt("PlayerB", "EUW1");
    const hash2 = JSON.parse(getCallArgs(0).body).properties.queryHash;

    expect(hash1).not.toBe(hash2);
    // Hash should be a short bounded string
    expect(typeof hash1).toBe("string");
    expect(hash1.length).toBeGreaterThan(0);
    expect(hash1.length).toBeLessThan(64);
    // Hash should not contain the raw identifier
    expect(hash1).not.toContain("PlayerA");
  });

  it("client-side matchRef is a bounded non-reversible reference", async () => {
    initAnalyticsSession();

    await trackMatchDetailView("NA1_1111111111");
    const ref1 = JSON.parse(getCallArgs(0).body).properties.matchRef;

    mockFetch.mockClear();
    await trackMatchDetailView("NA1_2222222222");
    const ref2 = JSON.parse(getCallArgs(0).body).properties.matchRef;

    expect(ref1).not.toBe(ref2);
    expect(typeof ref1).toBe("string");
    expect(ref1.length).toBeGreaterThan(0);
    expect(ref1.length).toBeLessThan(64);
    expect(ref1).not.toContain("NA1_1111111111");
  });

  it("client hashes are deterministic for same input", async () => {
    initAnalyticsSession();

    await trackSearchAttempt("SamePlayer", "EUW1");
    const h1 = JSON.parse(getCallArgs(0).body).properties.queryHash;

    mockFetch.mockClear();
    await trackSearchAttempt("SamePlayer", "EUW1");
    const h2 = JSON.parse(getCallArgs(0).body).properties.queryHash;

    expect(h1).toBe(h2);
  });

  it("client hashes are case-insensitive for game names", async () => {
    initAnalyticsSession();

    await trackSearchAttempt("PlayerA", "euw1");
    const h1 = JSON.parse(getCallArgs(0).body).properties.queryHash;

    mockFetch.mockClear();
    await trackSearchAttempt("playera", "EUW1");
    const h2 = JSON.parse(getCallArgs(0).body).properties.queryHash;

    expect(h1).toBe(h2);
  });
});
