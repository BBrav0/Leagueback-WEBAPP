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
function setApiKey(key = "test-analytics-key-12345678") {
  process.env.ANALYTICS_API_KEY = key;
}

function clearApiKey() {
  delete process.env.ANALYTICS_API_KEY;
}

function makeAuthRequest(key = "test-analytics-key-12345678", days = "7") {
  return new Request(`http://localhost/api/analytics/summary?days=${days}`, {
    headers: { Authorization: `Bearer ${key}` },
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
      makeAuthRequest("wrong-key-12345678")
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

  it("accepts requests with correct Bearer token", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [],
        totals: [],
        searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: {},
        matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [],
        noisyTraffic: { rejectedEvents: 0 },
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
        failureCategories: {},
        matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [],
        noisyTraffic: { rejectedEvents: 0 },
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/analytics/summary", {
        headers: { Authorization: "Bearer test-analytics-key-12345678" },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockGetSummary).toHaveBeenCalledWith(7, expect.any(Object));
  });

  it("clamps days=0 to 1", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [], totals: [], searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: {}, matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [], noisyTraffic: { rejectedEvents: 0 },
      },
    });

    const { GET } = await import("./route");
    await GET(makeAuthRequest("test-analytics-key-12345678", "0"));

    expect(mockGetSummary).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("clamps negative days to 1", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [], totals: [], searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: {}, matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [], noisyTraffic: { rejectedEvents: 0 },
      },
    });

    const { GET } = await import("./route");
    await GET(makeAuthRequest("test-analytics-key-12345678", "-5"));

    expect(mockGetSummary).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("clamps excessively large days to 365", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [], totals: [], searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: {}, matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [], noisyTraffic: { rejectedEvents: 0 },
      },
    });

    const { GET } = await import("./route");
    await GET(makeAuthRequest("test-analytics-key-12345678", "9999"));

    expect(mockGetSummary).toHaveBeenCalledWith(365, expect.any(Object));
  });

  it("handles non-numeric days by defaulting to 7", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [], totals: [], searchFunnel: { attempts: 0, successes: 0, failures: 0 },
        failureCategories: {}, matchDetailCounts: { matches: 0, details: 0 },
        endpointErrors: [], noisyTraffic: { rejectedEvents: 0 },
      },
    });

    const { GET } = await import("./route");
    await GET(makeAuthRequest("test-analytics-key-12345678", "abc"));

    expect(mockGetSummary).toHaveBeenCalledWith(7, expect.any(Object));
  });

  // VAL-SUMMARY-003: Summary response exposes aggregate analytics only
  it("returns aggregate-only summary with documented fields", async () => {
    mockGetSummary.mockResolvedValue({
      success: true,
      data: {
        daily: [{ day: "2026-05-10", event_name: "page_view", count: 10 }],
        totals: [{ event_name: "page_view", count: 42 }],
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
    expect(body).toHaveProperty("noisyTraffic");

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
    expect(body.noisyTraffic).toEqual({ rejectedEvents: 0 });
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
    expect(JSON.stringify(body)).not.toContain("postgres://");
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
        headers: { Authorization: "Bearer test-analytics-key-12345678" },
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
