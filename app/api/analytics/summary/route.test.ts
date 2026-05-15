import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Hoisted mock variables so vi.mock factories can reference them
const { mockGetSummary, mockGetSql } = vi.hoisted(() => ({
  mockGetSummary: vi.fn(),
  mockGetSql: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  getAnalyticsSummary: mockGetSummary,
}));

vi.mock("@/lib/neon", () => ({
  getSql: mockGetSql,
}));

// Helper to set ANALYTICS_API_KEY env var
const VALID_KEY = "a".repeat(32);
const WRONG_VALID_LENGTH_KEY = "b".repeat(32);

function setApiKey(key = VALID_KEY) {
  process.env["ANALYTICS_API_KEY"] = key;
}

function clearApiKey() {
  delete process.env.ANALYTICS_API_KEY;
}

function makeAuthRequest(key = VALID_KEY, days = "7") {
  return new Request(`http://localhost/api/analytics/summary?days=${days}`, {
    headers: { Authorization: ["Bearer", key].join(" ") },
  }) as never;
}

describe("GET /api/analytics/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApiKey();
    // Provide a default mock SQL client
    mockGetSql.mockReturnValue({ sql: vi.fn() });
  });

  // VAL-SUMMARY-001: Requires ANALYTICS_API_KEY
  it("rejects requests without Authorization header with 401", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/summary?days=7") as never
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).not.toHaveProperty("sql");
    expect(body).not.toHaveProperty("stack");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects requests with wrong API key with 401", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      makeAuthRequest(WRONG_VALID_LENGTH_KEY)
    );

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects requests when ANALYTICS_API_KEY is not configured", async () => {
    clearApiKey();
    const { GET } = await import("./route");
    const response = await GET(
      makeAuthRequest()
    );

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects requests when configured ANALYTICS_API_KEY is too short", async () => {
    setApiKey("short-placeholder");
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest("short-placeholder"));

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects requests when provided ANALYTICS_API_KEY is too short", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest("short-placeholder"));

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("accepts requests with correct auth credentials", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [],
        totals: [],
        searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: [],
        matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(200);
    expect(mockGetSummary).toHaveBeenCalledWith(7, expect.any(Object));
  });

  // VAL-SUMMARY-002: Days validation and bounds
  it("defaults days to 7 when not provided", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [],
        totals: [],
        searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: [],
        matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/summary", {
        headers: { Authorization: ["Bearer", VALID_KEY].join(" ") },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockGetSummary).toHaveBeenCalledWith(7, expect.any(Object));
  });

  // Scrutiny fix: days=0 returns 400 instead of silently clamping to 1
  it("rejects days=0 with 400", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "0"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Scrutiny fix: negative days returns 400 instead of silently clamping
  it("rejects negative days with 400", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "-5"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Scrutiny fix: excessive days returns 400 instead of silently clamping
  it("rejects excessively large days with 400", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "9999"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Scrutiny fix: non-numeric days returns 400 instead of defaulting
  it("rejects non-numeric days with 400", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "abc"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Regression: fractional days rejected with 400
  it("rejects fractional days with 400", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "3.5"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Regression: Infinity rejected with 400
  it("rejects Infinity days with 400", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "Infinity"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Regression: days=365 is the maximum valid value
  it("accepts days=365 as maximum valid value", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [], totals: [], searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: [], matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "365"));

    expect(response.status).toBe(200);
    expect(mockGetSummary).toHaveBeenCalledWith(365, expect.any(Object));
  });

  // Regression: days=1 is the minimum valid value
  it("accepts days=1 as minimum valid value", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [], totals: [], searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: [], matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest(VALID_KEY, "1"));

    expect(response.status).toBe(200);
    expect(mockGetSummary).toHaveBeenCalledWith(1, expect.any(Object));
  });

  // VAL-SUMMARY-003: Summary response exposes aggregate analytics only
  it("returns aggregate-only summary with documented fields", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [{ day: "2026-05-10", event_name: "page_view", count: 10 }],
        totals: [{ event_name: "page_view", count: 42 }],
        failureCategories: [],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(200);
    const body = await response.json();

    // Must have aggregate fields
    expect(body).toHaveProperty("daily");
    expect(body).toHaveProperty("totals");
    expect(body).toHaveProperty("searchFunnel");
    expect(body).toHaveProperty("failureCategories");
    expect(body).toHaveProperty("matchDetailCounts");
    expect(body).toHaveProperty("endpointErrors");

    // Must NOT have raw event rows or direct identifiers
    expect(body).not.toHaveProperty("events");
    expect(body).not.toHaveProperty("visitorId");
    expect(body).not.toHaveProperty("sessionId");
    expect(body).not.toHaveProperty("puuid");
    expect(body).not.toHaveProperty("properties");

    // Verify aggregate content
    expect(body.daily).toEqual([{ day: "2026-05-10", event_name: "page_view", count: 10 }]);
    expect(body.totals).toEqual([{ event_name: "page_view", count: 42 }]);
  });

  it("returns bounded failure sub-category detail without duplicating event totals", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [],
        totals: [{ event_name: "lookup_failure", count: 5 }],
        failureCategories: [
          { event_name: "lookup_failure", category: "account_not_found", count: 3 },
          { event_name: "lookup_failure", category: "rate_limited", count: 2 },
          { event_name: "endpoint_error", category: "server_error", count: 1 },
          { event_name: "client_error", category: "fetch_failure", count: 4 },
        ],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.failureCategories).toEqual({
      lookup_failure: { account_not_found: 3, rate_limited: 2 },
      endpoint_error: { server_error: 1 },
      client_error: { fetch_failure: 4 },
    });
    expect(body.failureCategories).not.toEqual({ lookup_failure: 5 });
  });

  // VAL-SUMMARY-004: Handles empty/sparse data
  it("returns stable 200 with zeroed fields for empty data", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [],
        totals: [],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.daily).toEqual([]);
    expect(body.totals).toEqual([]);
    expect(body.searchFunnel).toEqual({ attempts: 0, successes: 0, failures: 0 });
    expect(body.failureCategories).toEqual({});
    expect(body.matchDetailCounts).toEqual({ matches: 0, details: 0 });
    expect(body.endpointErrors).toEqual([]);
  });

  // VAL-SUMMARY-005: Error responses are safe
  it("returns safe non-2xx response on database failure without leaking details", async () => {
    mockGetSummary.mockResolvedValue({
      success: false,
      error: "Analytics summary query failed: connection refused",
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    // No SQL, no stack traces, no connection strings
    expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\//);
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(body).toHaveProperty("error");
  });

  // VAL-SUMMARY-006: Unsupported methods rejected
  it("rejects POST requests with 405", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/analytics/summary", {
        method: "POST",
        headers: { Authorization: ["Bearer", VALID_KEY].join(" ") },
      }) as never
    );
    expect(response.status).toBe(405);
  });

  // VAL-PRIVACY-001: Secrets not in response
  it("never exposes secrets in response bodies", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: { daily: [], totals: [] },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());
    const bodyStr = JSON.stringify(await response.json());

    expect(bodyStr).not.toContain("ANALYTICS_API_KEY");
    expect(bodyStr).not.toContain("DATABASE_URL");
    expect(bodyStr).not.toContain("RIOT_API_KEY");
  });

  // VAL-CROSS-004: Summary security boundary
  it("does not return visitor/session drilldowns", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: { daily: [], totals: [] },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());
    const body = await response.json();

    // Verify no visitor/session-level data in any field
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("visitor_id");
    expect(bodyStr).not.toContain("session_id");
    expect(bodyStr).not.toContain("visitorId");
    expect(bodyStr).not.toContain("sessionId");
  });
});

// -----------------------------------------------------------------------
// VAL-AN-026: Summary rejects all unsupported HTTP methods
// -----------------------------------------------------------------------

describe("unsupported HTTP methods on summary (VAL-AN-026)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANALYTICS_API_KEY"] = VALID_KEY;
    mockGetSql.mockReturnValue({ sql: vi.fn() });
  });

  it("rejects PUT requests with 405", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/analytics/summary", { method: "PUT" }) as never
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
    // Must not query analytics storage
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects DELETE requests with 405", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new Request("http://localhost/api/analytics/summary", { method: "DELETE" }) as never
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects PATCH requests with 405", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://localhost/api/analytics/summary", { method: "PATCH" }) as never
    );
    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("405 responses contain no sensitive details", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("http://localhost/api/analytics/summary", { method: "PUT" }) as never
    );
    const body = await response.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("DATABASE_URL");
    expect(bodyStr).not.toContain("ANALYTICS");
    expect(bodyStr).not.toContain("stack");
  });
});

// -----------------------------------------------------------------------
// VAL-AN-013 extended: Verify aggregate response contains no raw identifiers
// -----------------------------------------------------------------------

describe("summary response privacy (VAL-AN-013 extended)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANALYTICS_API_KEY"] = VALID_KEY;
    mockGetSql.mockReturnValue({ sql: vi.fn() });
  });

  it("response body contains no Riot-shaped identifiers even when summary has data", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [
          { day: "2026-05-10", event_name: "page_view", count: 42 },
          { day: "2026-05-10", event_name: "search_attempt", count: 15 },
        ],
        totals: [
          { event_name: "page_view", count: 100 },
          { event_name: "search_attempt", count: 30 },
        ],
      },
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    const bodyStr = JSON.stringify(body);

    // No Riot-shaped identifiers
    expect(bodyStr).not.toMatch(/NA1_\d+/);
    expect(bodyStr).not.toContain("puuid");
    expect(bodyStr).not.toContain("summonerId");
    expect(bodyStr).not.toContain("game_name");
    expect(bodyStr).not.toContain("tag_line");
    // No secrets or SQL
    expect(bodyStr).not.toContain("SELECT");
    expect(bodyStr).not.toContain("INSERT");
    expect(bodyStr).not.toMatch(/postgres(ql)?:\/\//);
  });
});

// -----------------------------------------------------------------------
// VAL-SUMMARY-001 extended: Malformed authorization patterns
// -----------------------------------------------------------------------

describe("malformed authorization patterns (VAL-SUMMARY-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANALYTICS_API_KEY"] = VALID_KEY;
    mockGetSql.mockReturnValue({ sql: vi.fn() });
  });

  it("rejects Basic scheme with 401", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/summary?days=7", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      }) as never
    );

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects empty Bearer token with 401", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/summary?days=7", {
        headers: { Authorization: "Bearer " },
      }) as never
    );

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("rejects Authorization header without scheme with 401", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/summary?days=7", {
        headers: { Authorization: "just-a-raw-token-value" },
      }) as never
    );

    expect(response.status).toBe(401);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// VAL-SUMMARY-011: Storage completely unavailable (getSql throws)
// -----------------------------------------------------------------------

describe("storage completely unavailable (VAL-SUMMARY-011)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANALYTICS_API_KEY"] = VALID_KEY;
  });

  it("returns 503 when getSql throws without leaking details", async () => {
    mockGetSql.mockImplementation(() => {
      throw new Error("Neon client not available");
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    // No SQL, no stack traces, no connection strings
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/postgres(ql)?:\/\//);
    expect(bodyStr).not.toContain("DATABASE_URL");
    expect(bodyStr).not.toContain("stack");
    expect(bodyStr).not.toContain("Neon");
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it("returns 503 when getAnalyticsSummary resolves with success false and a long error", async () => {
    mockGetSql.mockReturnValue({ sql: vi.fn() });
    mockGetSummary.mockResolvedValue({
      success: false,
      error: "Analytics summary query failed: connection refused at postgres://user:pass@host/db with very long detail that should be truncated safely without leaking internals",
    });

    const { GET } = await import("./route");
    const response = await GET(makeAuthRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    // The route returns a generic "Analytics summary unavailable" — no leaked detail
    expect(body.error).toBe("Analytics summary unavailable");
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/postgres(ql)?:\/\//);
    expect(bodyStr).not.toContain("user:pass");
    expect(bodyStr).not.toContain("DATABASE_URL");
  });
});
