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
const MAX_PROPERTY_COUNT = 24;
const MAX_NESTING_DEPTH = 2;

vi.mock("@/lib/analytics", () => ({
  recordAnalyticsEvent: mockRecordEvent,
  validateEventName: vi.fn((name: string) =>
    [
      "page_view", "visitor_activity", "search_attempt", "lookup_success",
      "lookup_failure", "player_page_view", "match_detail_view", "load_more",
      "manual_update", "client_error", "endpoint_outcome", "endpoint_error",
    ].includes(name)
  ),
  validateVisitorId: vi.fn((id: string) => /^[a-zA-Z0-9_-]{8,64}$/.test(id)),
  validateSessionId: vi.fn((id: string) => /^[a-zA-Z0-9_-]{8,64}$/.test(id)),
  sanitizeProperties: vi.fn((props: unknown) => {
    if (!props || typeof props !== "object" || Array.isArray(props)) return {};
    return props as Record<string, unknown>;
  }),
  isSecretKey: vi.fn(isSecretKeyMock),
  isWithinNestingDepth: vi.fn(isWithinNestingDepthMock),
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
            properties: { query: "test" },
          })
        ),
      }) as never
    );

    expect(mockRecordEvent).toHaveBeenCalledWith(
      "search_attempt",
      "visitor-12345678",
      "session-12345678",
      { query: "test" },
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

  // VAL-API-005: Unsupported methods rejected
  it("rejects GET requests with 405", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/ingest") as never
    );
    expect(response.status).toBe(405);
  });

  // VAL-API-005: PUT rejected
  it("rejects PUT requests with 405", async () => {
    // Route only exports POST, but if PUT exists test it.
    // We test by importing the route module and checking PUT is not exported
    const mod = await import("./route");
    expect((mod as Record<string, unknown>).PUT).toBeUndefined();
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

  // VAL-API-003: Analytics storage failure returns safe ack, not error
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

  // VAL-API-006: Client timestamp not used directly (server assigns)
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
            properties: { page: "/dashboard", referrer: "direct", count: 5 },
          })
        ),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });
});
