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
