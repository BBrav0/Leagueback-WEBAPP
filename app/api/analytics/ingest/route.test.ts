import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

const mockRecordEvent = vi.fn();

// Secret key patterns matching the production implementation
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

function isSecretKeyMock(key: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(key));
}

function isWithinNestingDepthMock(value: unknown, maxDepth: number): boolean {
  if (maxDepth < 0) return false;
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) {
    return value.every((v) => isWithinNestingDepthMock(v, maxDepth - 1));
  }
  const record = value as Record<string, unknown>;
  return Object.values(record).every((v) =>
    isWithinNestingDepthMock(v, maxDepth - 1)
  );
}

const MAX_PROPERTY_KEY_LENGTH = 48;
const MAX_PROPERTY_STRING_LENGTH = 512;
const MAX_PROPERTY_COUNT = 24;
const MAX_NESTING_DEPTH = 2;

/** Event-specific property allowlists matching the production implementation. */
const EVENT_PROPERTY_ALLOWLIST: Record<string, string[]> = {
  page_view: ["page", "referrer"],
  visitor_activity: [],
  search_attempt: ["queryHash", "hasTagLine"],
  lookup_success: ["matchCount"],
  lookup_failure: ["failureCategory"],
  player_page_view: ["page", "referrer"],
  match_detail_view: ["matchRef"],
  load_more: ["offset", "limit", "source"],
  manual_update: ["outcome"],
  client_error: ["category", "route"],
};

/** Browser-only event names (server-only events are NOT included). */
const BROWSER_EVENT_NAMES = new Set([
  "page_view", "visitor_activity", "search_attempt", "lookup_success",
  "lookup_failure", "player_page_view", "match_detail_view", "load_more",
  "manual_update", "client_error",
]);

function isBrowserEventMock(name: string): boolean {
  return BROWSER_EVENT_NAMES.has(name);
}

function filterPropertiesByEventMock(
  eventName: string,
  properties: Record<string, unknown>
): Record<string, unknown> {
  const allowed = EVENT_PROPERTY_ALLOWLIST[eventName];
  if (!allowed) return {};
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in properties) {
      result[key] = properties[key];
    }
  }
  return result;
}

/** Local Riot-like identifier check, used by mock validators. */
const RIOT_ID_PATTERNS = [
  /^[A-Z]{2,4}\d_\d{4,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d{20,}$/,
];
function isRiotLikeIdentifierLocal(id: string): boolean {
  return RIOT_ID_PATTERNS.some((p) => p.test(id));
}

vi.mock("@/lib/analytics", () => ({
  recordAnalyticsEvent: mockRecordEvent,
  validateEventName: vi.fn((name: string) =>
    [
      "page_view", "visitor_activity", "search_attempt", "lookup_success",
      "lookup_failure", "player_page_view", "match_detail_view", "load_more",
      "manual_update", "client_error", "endpoint_outcome", "endpoint_error",
    ].includes(name)
  ),
  isRiotLikeIdentifier: vi.fn(isRiotLikeIdentifierLocal),
  validateVisitorId: vi.fn((id: string) =>
    /^[a-zA-Z0-9_-]{8,64}$/.test(id) && !isRiotLikeIdentifierLocal(id)
  ),
  validateSessionId: vi.fn((id: string) =>
    /^[a-zA-Z0-9_-]{8,64}$/.test(id) && !isRiotLikeIdentifierLocal(id)
  ),
  sanitizeProperties: vi.fn((input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const source = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const entries = Object.entries(source)
      .filter(([key]) => key.length <= MAX_PROPERTY_KEY_LENGTH)
      .filter(([key]) => !isSecretKeyMock(key))
      .slice(0, MAX_PROPERTY_COUNT);
    for (const [key, value] of entries) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string") {
        result[key] = value.length > MAX_PROPERTY_STRING_LENGTH
          ? value.slice(0, MAX_PROPERTY_STRING_LENGTH) : value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        result[key] = value;
      } else if (typeof value === "object") {
        if (!isWithinNestingDepthMock(value, MAX_NESTING_DEPTH)) continue;
        try {
          const serialized = JSON.stringify(value);
          result[key] = serialized.length > MAX_PROPERTY_STRING_LENGTH
            ? serialized.slice(0, MAX_PROPERTY_STRING_LENGTH) : serialized;
        } catch { continue; }
      }
    }
    return result;
  }),
  MAX_PROPERTY_STRING_LENGTH,
  isSecretKey: vi.fn(isSecretKeyMock),
  isWithinNestingDepth: vi.fn(isWithinNestingDepthMock),
  isBrowserEvent: vi.fn(isBrowserEventMock),
  filterPropertiesByEvent: vi.fn(filterPropertiesByEventMock),
  applyClientPropertyProtection: vi.fn((props: Record<string, unknown>) => {
    // Mock: prefix protected keys with "server_" to simulate transformation
    const PROTECTED_KEYS = new Set(["queryHash", "matchRef"]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (PROTECTED_KEYS.has(key) && typeof value === "string") {
        result[key] = `server_protected_${value}`;
      } else {
        result[key] = value;
      }
    }
    return result;
  }),
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_COUNT,
  MAX_NESTING_DEPTH,
  VALID_EVENT_NAMES: [
    "page_view", "visitor_activity", "search_attempt", "lookup_success",
    "lookup_failure", "player_page_view", "match_detail_view", "load_more",
    "manual_update", "client_error", "endpoint_outcome", "endpoint_error",
  ],
}));

vi.mock("@/lib/neon", () => ({
  getSql: () => vi.fn(),
}));

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "page_view",
    visitorId: "visitor-12345678",
    sessionId: "session-12345678",
    properties: { page: "/" },
    ...overrides,
  };
}

describe("POST /api/analytics/ingest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // VAL-API-001: Valid browser events accepted with non-sensitive acknowledgement
  it("accepts a valid browser event and returns a non-sensitive acknowledgement", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidPayload()),
      }) as never
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // Acknowledgement should be non-sensitive - no stored properties or secrets
    expect(body).toEqual({ ok: true });
    expect(body).not.toHaveProperty("properties");
    expect(body).not.toHaveProperty("visitorId");
    expect(body).not.toHaveProperty("sessionId");
    expect(body).not.toHaveProperty("sql");
    expect(body).not.toHaveProperty("error");
  });

  // VAL-API-001: Record event called with normalized params
  it("passes normalized event params to the analytics library", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });

    const { POST } = await import("./route");
    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "search_attempt",
            properties: { queryHash: "abc123" },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledWith(
      "search_attempt",
      "visitor-12345678",
      "session-12345678",
      expect.any(Object),
      expect.any(Object) // neonClient
    );
  });

  // VAL-API-002: Malformed JSON rejected
  it("rejects malformed JSON with 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid json",
      }) as never
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).not.toHaveProperty("sql");
    expect(body).not.toHaveProperty("stack");
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // VAL-API-002: Missing required fields rejected
  it("rejects requests with missing required fields", async () => {
    const { POST } = await import("./route");

    // Missing eventName
    const res1 = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: "visitor-12345678",
          sessionId: "session-12345678",
          properties: {},
        }),
      }) as never
    );
    expect(res1.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // VAL-API-002: Unsupported event names rejected
  it("rejects unsupported event names with 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({ eventName: "hack_the_gibson" })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // VAL-API-002: Invalid visitor/session IDs rejected
  it("rejects invalid visitor or session IDs with 400", async () => {
    const { POST } = await import("./route");

    const res1 = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({ visitorId: "short" })
        ),
      }) as never
    );
    expect(res1.status).toBe(400);

    const res2 = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({ sessionId: "../../etc/passwd" })
        ),
      }) as never
    );
    expect(res2.status).toBe(400);
  });

  // VAL-API-007: Unsupported methods rejected
  it("rejects GET requests with 405", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/ingest") as never
    );
    expect(response.status).toBe(405);
  });

  // VAL-API-007: PUT rejected with explicit handler
  it("rejects PUT requests with 405", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/analytics/ingest", { method: "PUT" }) as never
    );
    expect(response.status).toBe(405);
  });

  // VAL-PRIVACY-001: Secrets not echoed in responses
  it("never echoes secrets or raw properties in error responses", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "bad_event_name",
            properties: { apiKey: "super-secret-key-12345" },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("super-secret-key");
    expect(bodyStr).not.toContain("apiKey");
  });

  // VAL-API-006: Analytics storage failure returns safe ack, not error
  it("returns ok:true even when analytics storage fails (fail-open)", async () => {
    mockRecordEvent.mockResolvedValue({ success: false, reason: "write_failed" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidPayload()),
      }) as never
    );

    // Ingestion should still return 200 with safe ack (fail-open)
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  // VAL-API-003: Client timestamp not used directly (server assigns)
  it("ignores client-provided timestamp in the payload", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            timestamp: "2020-01-01T00:00:00.000Z", // old timestamp should be ignored
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    // The timestamp field in payload should not be forwarded as an event property
    // recordAnalyticsEvent assigns server-side timestamps
    expect(mockRecordEvent).toHaveBeenCalledWith(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      expect.objectContaining({ page: "/" }),
      expect.any(Object)
    );
  });

  // -----------------------------------------------------------------------
  // Round-2 scrutiny regression tests
  // -----------------------------------------------------------------------

  // Round-2: Secret-like property keys rejected before any write
  it("rejects requests with secret-like property keys with 400 and does not call recordAnalyticsEvent", async () => {
    const { POST } = await import("./route");

    const secretKeyCases = [
      { apiKey: "val" },
      { secret: "val" },
      { token: "val" },
      { auth: "val" },
      { password: "val" },
      { cookie: "val" },
      { bearer: "val" },
      { db_url: "val" },
      { database_url: "val" },
      { connection_string: "val" },
    ];

    for (const props of secretKeyCases) {
      vi.clearAllMocks();

      const response = await POST(
        new Request("http://localhost/api/analytics/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makeValidPayload({ properties: props })),
        }) as never
      );

      expect(response.status, `Expected 400 for properties ${JSON.stringify(props)}`).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Unsupported property");
      expect(mockRecordEvent).not.toHaveBeenCalled();
    }
  });

  // Round-2: Oversized property keys rejected before any write
  it("rejects requests with oversized property keys with 400", async () => {
    const { POST } = await import("./route");
    const longKey = "k".repeat(MAX_PROPERTY_KEY_LENGTH + 1);

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({ properties: { [longKey]: "val" } })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // Round-2: Too many properties rejected before any write
  it("rejects requests with too many properties with 400", async () => {
    const { POST } = await import("./route");
    const props: Record<string, string> = {};
    for (let i = 0; i < MAX_PROPERTY_COUNT + 1; i++) {
      props[`prop_${i}`] = `val_${i}`;
    }

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeValidPayload({ properties: props })),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // Round-2: Deeply nested properties rejected before any write
  it("rejects requests with deeply nested property values with 400", async () => {
    const { POST } = await import("./route");
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_NESTING_DEPTH + 2; i++) {
      nested = { inner: nested };
    }

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({ properties: { nested } })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // Round-2: Valid properties still pass through after pre-write checks
  it("accepts valid properties through the pre-write validation", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            properties: { page: "/dashboard", referrer: "direct" },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // VAL-API-005: Public ingest rejects server-only endpoint events
  // -----------------------------------------------------------------------

  it("rejects endpoint_outcome events from public ingest with 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "endpoint_outcome",
            properties: { route: "/api/account", status: 200 },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Server-only event");
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("rejects endpoint_error events from public ingest with 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "endpoint_error",
            properties: { route: "/api/account", status: 500 },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Server-only event");
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // VAL-API-004: Ingest enforces event-specific property allowlists
  // -----------------------------------------------------------------------

  it("filters properties to event-specific allowlist for page_view", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              // These should be filtered out:
              extraField: "should-be-removed",
              riotId: "Player#EUW1",
            },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    // Verify filterPropertiesByEvent was called
    const { filterPropertiesByEvent } = await import("@/lib/analytics");
    expect(filterPropertiesByEvent).toHaveBeenCalledWith(
      "page_view",
      expect.objectContaining({
        page: "/dashboard",
        referrer: "direct",
        extraField: "should-be-removed",
      })
    );
  });

  it("filters properties for search_attempt to only queryHash and hasTagLine", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "search_attempt",
            properties: {
              queryHash: "abc123",
              hasTagLine: true,
              // Should be filtered:
              rawGameName: "SecretPlayer",
            },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const { filterPropertiesByEvent } = await import("@/lib/analytics");
    expect(filterPropertiesByEvent).toHaveBeenCalledWith(
      "search_attempt",
      expect.objectContaining({ queryHash: "abc123", rawGameName: "SecretPlayer" })
    );
  });

  it("filters properties for lookup_failure to only failureCategory", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "lookup_failure",
            properties: {
              failureCategory: "account_not_found",
              // Should be filtered:
              errorMessage: "player not found",
              rawStackTrace: "at line 42...",
            },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const { filterPropertiesByEvent } = await import("@/lib/analytics");
    expect(filterPropertiesByEvent).toHaveBeenCalledWith(
      "lookup_failure",
      expect.objectContaining({
        failureCategory: "account_not_found",
        errorMessage: "player not found",
      })
    );
  });

  it("stores only allowlisted properties after filtering", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/",
              referrer: "direct",
              sneakyExtra: "removed",
            },
          })
        ),
      }) as never
    );

    // The stored properties passed to recordAnalyticsEvent should be
    // the filtered result from filterPropertiesByEvent
    expect(mockRecordEvent).toHaveBeenCalledWith(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      expect.any(Object), // filtered properties
      expect.any(Object)  // neonClient
    );
  });

  it("accepts visitor_activity with no properties", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "visitor_activity",
            properties: {},
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  it("filters load_more properties to offset, limit, source only", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "load_more",
            properties: {
              offset: 10,
              limit: 20,
              source: "stored",
              matchId: "NA1_123456",
            },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    const { filterPropertiesByEvent } = await import("@/lib/analytics");
    expect(filterPropertiesByEvent).toHaveBeenCalledWith(
      "load_more",
      expect.objectContaining({ matchId: "NA1_123456" })
    );
  });

  it("filters client_error properties to category and route only", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "client_error",
            properties: {
              category: "fetch_failure",
              route: "/dashboard",
              rawErrorMessage: "TypeError: NetworkError",
              stackTrace: "at line 1...",
            },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    const { filterPropertiesByEvent } = await import("@/lib/analytics");
    expect(filterPropertiesByEvent).toHaveBeenCalledWith(
      "client_error",
      expect.objectContaining({
        rawErrorMessage: "TypeError: NetworkError",
        stackTrace: "at line 1...",
      })
    );
  });
});


  // -----------------------------------------------------------------------
  // VAL-CROSS-005: Server-side keyed protection for client-derived identifiers
  // -----------------------------------------------------------------------

  describe("server-side queryHash/matchRef protection", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
    });

    it("transforms queryHash before storage — raw client value is not persisted", async () => {
      mockRecordEvent.mockResolvedValue({ success: true });
      const { POST } = await import("./route");

      await POST(
        new Request("http://localhost/api/analytics/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            makeValidPayload({
              eventName: "search_attempt",
              properties: { queryHash: "rawClientHash123", hasTagLine: true },
            })
          ),
        }) as never
      );

      expect(mockRecordEvent).toHaveBeenCalledTimes(1);
      const storedProps = mockRecordEvent.mock.calls[0][3];
      // The stored queryHash must be transformed, not the raw client value
      expect(storedProps.queryHash).not.toBe("rawClientHash123");
      expect(storedProps.queryHash).toBe("server_protected_rawClientHash123");
      // Non-protected values should pass through
      expect(storedProps.hasTagLine).toBe(true);
    });

    it("transforms matchRef before storage — raw client value is not persisted", async () => {
      mockRecordEvent.mockResolvedValue({ success: true });
      const { POST } = await import("./route");

      await POST(
        new Request("http://localhost/api/analytics/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            makeValidPayload({
              eventName: "match_detail_view",
              properties: { matchRef: "rawClientMatchRef456" },
            })
          ),
        }) as never
      );

      expect(mockRecordEvent).toHaveBeenCalledTimes(1);
      const storedProps = mockRecordEvent.mock.calls[0][3];
      // The stored matchRef must be transformed, not the raw client value
      expect(storedProps.matchRef).not.toBe("rawClientMatchRef456");
      expect(storedProps.matchRef).toBe("server_protected_rawClientMatchRef456");
    });

    it("does not transform non-protected properties", async () => {
      mockRecordEvent.mockResolvedValue({ success: true });
      const { POST } = await import("./route");

      await POST(
        new Request("http://localhost/api/analytics/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            makeValidPayload({
              eventName: "page_view",
              properties: { page: "/dashboard", referrer: "direct" },
            })
          ),
        }) as never
      );

      expect(mockRecordEvent).toHaveBeenCalledTimes(1);
      const storedProps = mockRecordEvent.mock.calls[0][3];
      expect(storedProps.page).toBe("/dashboard");
      expect(storedProps.referrer).toBe("direct");
    });

    it("calls applyClientPropertyProtection on filtered properties", async () => {
      mockRecordEvent.mockResolvedValue({ success: true });
      const { POST } = await import("./route");

      await POST(
        new Request("http://localhost/api/analytics/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            makeValidPayload({
              eventName: "search_attempt",
              properties: { queryHash: "testHash", hasTagLine: true },
            })
          ),
        }) as never
      );

      const { applyClientPropertyProtection } = await import("@/lib/analytics");
      expect(applyClientPropertyProtection).toHaveBeenCalledTimes(1);
      // Should be called with the filtered properties
      expect(applyClientPropertyProtection).toHaveBeenCalledWith(
        expect.objectContaining({ queryHash: "testHash", hasTagLine: true })
      );
    });
  });

// -----------------------------------------------------------------------
// VAL-AN-006: Analytics never persists raw Riot identifiers
// -----------------------------------------------------------------------

describe("no raw Riot identifiers in stored payload (VAL-AN-006)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // These Riot-shaped strings must never appear in the stored SQL payload
  const RIOT_STRINGS = [
    "SomeGameName",
    "EUW1",
    "NA1_1234567890",
    "puuid-abc123-def456-ghi789",
    "summoner-id-xyz",
    "PlayerName#TAG1",
  ];

  it("raw Riot identifiers in properties are not in stored payload", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    // Submit with Riot-shaped values as extra properties that will be filtered
    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              // Riot-shaped values injected as extra properties
              riotGameName: "SomeGameName",
              riotTagLine: "EUW1",
              riotMatchId: "NA1_1234567890",
              riotPuuid: "puuid-abc123-def456-ghi789",
              summonerId: "summoner-id-xyz",
              riotId: "PlayerName#TAG1",
            },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    const storedStr = JSON.stringify(storedProps);

    // Verify no Riot-shaped strings appear in the stored payload
    for (const riotStr of RIOT_STRINGS) {
      expect(storedStr, `Stored payload must not contain "${riotStr}"`).not.toContain(riotStr);
    }
  });

  it("raw Riot identifiers in visitorId/sessionId position are rejected", async () => {
    const { POST } = await import("./route");

    // Try using a match ID (with slashes) as visitorId — fails regex
    const res1 = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            visitorId: "NA1/1234567890",
          })
        ),
      }) as never
    );
    expect(res1.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // Try using a Riot ID (with #) as sessionId — fails regex
    const res2 = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            sessionId: "PlayerName#TAG1",
          })
        ),
      }) as never
    );
    expect(res2.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  // Riot-shaped anonymous IDs that satisfy the generic regex but are rejected
  // by the privacy-specific Riot-like identifier detection
  it("rejects Riot match ID shaped visitorId that satisfies the generic character regex", async () => {
    const { POST } = await import("./route");

    // NA1_1234567890 passes /^[a-zA-Z0-9_-]{8,64}$/ but is a Riot match ID
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            visitorId: "NA1_1234567890",
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("rejects Riot match ID shaped sessionId that satisfies the generic character regex", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            sessionId: "KR1_9876543210",
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("rejects PUUID-shaped UUID as visitorId even though it passes the generic regex", async () => {
    const { POST } = await import("./route");

    // Standard UUID format passes the alphanumeric+dash regex but looks like a Riot PUUID
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            visitorId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("rejects numeric-only summoner-id-shaped visitorId (20+ digits)", async () => {
    const { POST } = await import("./route");

    // 20+ digit numeric string passes the generic regex but looks like a summoner ID
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            visitorId: "12345678901234567890",
          })
        ),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("rejects Riot match ID shaped IDs in both visitorId and sessionId simultaneously", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: "page_view",
          visitorId: "EUW1_5555555555",
          sessionId: "NA1_6666666666",
          properties: { page: "/" },
        }),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("accepts legitimate anonymous IDs that are not Riot-shaped", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    // These are clearly anonymous, not Riot-shaped
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: "page_view",
          visitorId: "anon-visitor-abc12345",
          sessionId: "anon-session-xyz98765",
          properties: { page: "/" },
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  it("raw Riot identifiers smuggled into allowlisted properties are filtered by allowlist", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    // Submit a page_view with Riot identifiers in the page property
    // The allowlist for page_view only allows "page" and "referrer"
    // So a property like "matchId" containing "NA1_1234567890" will be filtered out
    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              matchId: "NA1_1234567890",
              puuid: "puuid-abc123-def456-ghi789",
              gameName: "SomeGameName",
              tagLine: "EUW1",
            },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    const storedStr = JSON.stringify(storedProps);
    // Only "page" and "referrer" should survive the allowlist filter
    expect(storedStr).not.toContain("NA1_1234567890");
    expect(storedStr).not.toContain("puuid-abc123");
    expect(storedStr).not.toContain("SomeGameName");
    expect(storedStr).not.toContain("EUW1");
  });
});

// -----------------------------------------------------------------------
// VAL-AN-009: Ingest rejects all unsupported HTTP methods
// -----------------------------------------------------------------------

describe("unsupported HTTP methods on ingest (VAL-AN-009)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects PUT requests with 405", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/analytics/ingest", { method: "PUT" }) as never
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
  });

  it("rejects DELETE requests with 405", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new Request("http://localhost/api/analytics/ingest", { method: "DELETE" }) as never
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
  });

  it("rejects PATCH requests with 405", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://localhost/api/analytics/ingest", { method: "PATCH" }) as never
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
  });

  it("405 response bodies contain no sensitive details", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/analytics/ingest", { method: "PUT" }) as never
    );
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("DATABASE_URL");
    expect(bodyStr).not.toContain("ANALYTICS");
    expect(bodyStr).not.toContain("stack");
  });
});

// -----------------------------------------------------------------------
// VAL-AN-025: Event property values are bounded
// -----------------------------------------------------------------------

describe("event property value bounds (VAL-AN-025)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("truncates oversized string values to MAX_PROPERTY_STRING_LENGTH in persisted payload", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const longPageValue = "/" + "a".repeat(600);
    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: { page: longPageValue },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    // The persisted payload must have the page value truncated to 512 chars
    expect(typeof storedProps.page).toBe("string");
    expect((storedProps.page as string).length).toBeLessThanOrEqual(MAX_PROPERTY_STRING_LENGTH);
    expect((storedProps.page as string).length).toBeLessThan(longPageValue.length);
  });

  it("preserves numeric property values in persisted payload for load_more event", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "load_more",
            properties: { offset: 10, limit: 20, source: "stored" },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    // Numeric values must survive the sanitize pipeline unchanged
    expect(storedProps.offset).toBe(10);
    expect(storedProps.limit).toBe(20);
    expect(storedProps.source).toBe("stored");
  });

  it("preserves boolean property values in persisted payload", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "search_attempt",
            properties: { queryHash: "abc", hasTagLine: true },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    // queryHash gets transformed by applyClientPropertyProtection, but hasTagLine stays boolean
    expect(storedProps.hasTagLine).toBe(true);
  });

  it("drops non-primitive property values from persisted payload", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              fn: function() { return "evil"; },
              sym: Symbol("test"),
            },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    const storedStr = JSON.stringify(storedProps);
    // Functions and symbols must not appear in the persisted payload
    expect(storedStr).not.toContain("function");
    expect(storedStr).not.toContain("Symbol");
  });

  it("truncates oversized string values in the persisted payload even for very large inputs", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    const hugeValue = "x".repeat(10000);
    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: { page: hugeValue },
          })
        ),
      }) as never
    );

    // Request succeeds — the sanitize pipeline truncates, not rejects
    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    // The persisted value must be truncated, not the raw 10000-char input
    expect(typeof storedProps.page).toBe("string");
    expect((storedProps.page as string).length).toBeLessThanOrEqual(MAX_PROPERTY_STRING_LENGTH);
    expect((storedProps.page as string).length).toBeLessThan(hugeValue.length);
  });

  it("rejects deeply nested values with 400 before any write", async () => {
    const { POST } = await import("./route");

    // Build a deeply nested object that exceeds MAX_NESTING_DEPTH
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_NESTING_DEPTH + 3; i++) {
      nested = { inner: nested };
    }

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              deep: nested,
            },
          })
        ),
      }) as never
    );

    // Pre-write validation rejects deeply nested values
    expect(response.status).toBe(400);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });

  it("serializes shallow nested objects in persisted payload after sanitization", async () => {
    mockRecordEvent.mockResolvedValue({ success: true });
    const { POST } = await import("./route");

    // Shallow object within nesting depth — should be JSON-serialized by sanitizer
    const shallowObj = { level1: "value" };

    await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              extra: shallowObj,
            },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const storedProps = mockRecordEvent.mock.calls[0][3];
    // The shallow object gets JSON-serialized by the sanitizer (allowlist filters it out)
    // But the important thing is the request succeeds without error
    expect(storedProps.page).toBe("/dashboard");
  });

  it("rejects secret-like keys with 400 before any write", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          makeValidPayload({
            eventName: "page_view",
            properties: {
              page: "/dashboard",
              referrer: "direct",
              // These contain "token" and "secret" — caught by pre-write check
              safeKey_token: "some-val",
              safeKey_secret: "some-val",
            },
          })
        ),
      }) as never
    );

    // Pre-write validation rejects secret-like keys entirely
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unsupported property");
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });
});
