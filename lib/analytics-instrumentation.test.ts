// Mock server-only so tests can import the module
vi.mock("server-only", () => ({}));

// Use vi.hoisted so the mock variable is available in vi.mock factory
const { mockRecordEvent } = vi.hoisted(() => ({
  mockRecordEvent: vi.fn(),
}));

vi.mock("./analytics", () => ({
  recordAnalyticsEvent: mockRecordEvent,
  sanitizeRoutePath: vi.fn((path: string) => path),
  sanitizeProperties: vi.fn((props: unknown) => props),
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { instrumentRoute, instrumentRouteModule } from "./analytics-instrumentation";

describe("instrumentRoute", () => {
  const mockNeonClient = { sql: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordEvent.mockResolvedValue({ success: true });
  });

  // VAL-API-004: Emits exactly one endpoint outcome event per request
  it("emits one endpoint_outcome event for successful requests", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const wrapped = instrumentRoute("/api/account", handler, mockNeonClient);

    const response = await wrapped(new Request("http://localhost/api/account?gameName=test&tagLine=EUW1"));

    // Response must be identical to original handler response
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    // Analytics event emitted (fire-and-forget, so await a tick)
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      "endpoint_outcome",
      "server-route-instrument",
      "server-route-session-01",
      expect.objectContaining({
        route: "/api/account",
        status: 200,
        statusClass: "2xx",
      }),
      mockNeonClient
    );
  });

  it("emits endpoint_error event for 4xx responses", async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing param" }), { status: 400 })
    );
    const wrapped = instrumentRoute("/api/match-history", handler, mockNeonClient);

    const response = await wrapped(new Request("http://localhost/api/match-history"));

    expect(response.status).toBe(400);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      "endpoint_error",
      "server-route-instrument",
      "server-route-session-01",
      expect.objectContaining({
        route: "/api/match-history",
        status: 400,
        statusClass: "4xx",
        failureCategory: "client_error",
      }),
      mockNeonClient
    );
  });

  it("emits endpoint_error with rate_limited category for 429 responses", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    const wrapped = instrumentRoute("/api/match-performance", handler, mockNeonClient);

    await wrapped(new Request("http://localhost/api/match-performance"));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordEvent).toHaveBeenCalledWith(
      "endpoint_error",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        status: 429,
        failureCategory: "rate_limited",
      }),
      mockNeonClient
    );
  });

  it("emits endpoint_error with server_error category for 5xx responses", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const wrapped = instrumentRoute("/api/stored-matches", handler, mockNeonClient);

    await wrapped(new Request("http://localhost/api/stored-matches"));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordEvent).toHaveBeenCalledWith(
      "endpoint_error",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        status: 500,
        failureCategory: "server_error",
      }),
      mockNeonClient
    );
  });

  // VAL-API-007: Instrumentation preserves primary route behavior
  it("preserves the original response body and status", async () => {
    const originalBody = JSON.stringify({ success: true, data: [1, 2, 3] });
    const handler = vi.fn().mockResolvedValue(
      new Response(originalBody, { status: 200, headers: { "X-Custom": "yes" } })
    );
    const wrapped = instrumentRoute("/api/test", handler, mockNeonClient);

    const response = await wrapped(new Request("http://localhost/api/test"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Custom")).toBe("yes");
    const body = await response.json();
    expect(body).toEqual({ success: true, data: [1, 2, 3] });
  });

  // VAL-API-003: Analytics failure does not break product flow
  it("does not throw or alter response when analytics write fails", async () => {
    mockRecordEvent.mockRejectedValue(new Error("Analytics DB down"));
    const handler = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
    const wrapped = instrumentRoute("/api/test", handler, mockNeonClient);

    // Must not throw
    const response = await wrapped(new Request("http://localhost/api/test"));
    expect(response.status).toBe(200);
  });

  // VAL-PRIVACY-001: No secrets in event properties
  it("never includes secrets in event properties", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const wrapped = instrumentRoute("/api/test", handler, mockNeonClient);

    await wrapped(new Request("http://localhost/api/test"));
    await new Promise((r) => setTimeout(r, 10));

    const callArgs = mockRecordEvent.mock.calls[0];
    const props = callArgs[3]; // properties argument

    const propsStr = JSON.stringify(props);
    expect(propsStr).not.toContain("RIOT_API_KEY");
    expect(propsStr).not.toContain("DATABASE_URL");
    expect(propsStr).not.toContain("ANALYTICS_API_KEY");
    expect(propsStr).not.toContain("Bearer");
  });

  // VAL-PRIVACY-003: Properties use coarse/bounded fields
  it("uses route template instead of raw path with identifiers", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const wrapped = instrumentRoute("/api/account", handler, mockNeonClient);

    // The request URL has a query string with identifiers
    await wrapped(new Request("http://localhost/api/account?gameName=SecretPlayer&tagLine=EUW1"));
    await new Promise((r) => setTimeout(r, 10));

    const callArgs = mockRecordEvent.mock.calls[0];
    const props = callArgs[3];
    // Route must be the template, not the raw URL
    expect(props.route).toBe("/api/account");
    // No raw query params or identifiers in properties
    const propsStr = JSON.stringify(props);
    expect(propsStr).not.toContain("SecretPlayer");
    expect(propsStr).not.toContain("gameName");
    expect(propsStr).not.toContain("tagLine");
  });

  // Scrutiny regression: thrown handler errors emit exactly one sanitized endpoint_error
  it("emits one endpoint_error event when handler throws", async () => {
    const handlerError = new Error("Unexpected internal failure");
    const handler = vi.fn().mockRejectedValue(handlerError);
    const wrapped = instrumentRoute("/api/test-throws", handler, mockNeonClient);

    // The wrapped handler should re-throw the error (preserve route semantics)
    await expect(
      wrapped(new Request("http://localhost/api/test-throws"))
    ).rejects.toThrow("Unexpected internal failure");

    // Wait for async analytics event
    await new Promise((r) => setTimeout(r, 10));

    // Should emit exactly one endpoint_error event
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      "endpoint_error",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        route: "/api/test-throws",
        status: 500,
        statusClass: "5xx",
        failureCategory: "unhandled_exception",
      }),
      mockNeonClient
    );
  });

  // Scrutiny regression: thrown error analytics does not include raw error message
  it("scrubs thrown error details from analytics event properties", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Database connection string: postgres://user:pass@host/db"));
    const wrapped = instrumentRoute("/api/test", handler, mockNeonClient);

    await expect(
      wrapped(new Request("http://localhost/api/test"))
    ).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const callArgs = mockRecordEvent.mock.calls[0];
    const props = callArgs[3];
    const propsStr = JSON.stringify(props);

    // The error message should NOT be in the properties
    expect(propsStr).not.toContain("postgres://");
    expect(propsStr).not.toContain("Database connection string");
    expect(propsStr).not.toContain("user:pass");
  });

  // Scrutiny regression: thrown error still re-throws (preserves route semantics)
  it("preserves original thrown error type and message", async () => {
    const originalError = new TypeError("Cannot read property of undefined");
    const handler = vi.fn().mockRejectedValue(originalError);
    const wrapped = instrumentRoute("/api/test", handler, mockNeonClient);

    try {
      await wrapped(new Request("http://localhost/api/test"));
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBe(originalError);
      expect(err).toBeInstanceOf(TypeError);
      expect((err as TypeError).message).toBe("Cannot read property of undefined");
    }

    await new Promise((r) => setTimeout(r, 10));
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });

  // Scrutiny regression: analytics failure during thrown error handling does not suppress the original error
  it("still re-throws original error when analytics write fails during thrown error", async () => {
    mockRecordEvent.mockRejectedValue(new Error("Analytics DB down"));
    const originalError = new Error("Route crashed");
    const handler = vi.fn().mockRejectedValue(originalError);
    const wrapped = instrumentRoute("/api/test", handler, mockNeonClient);

    await expect(
      wrapped(new Request("http://localhost/api/test"))
    ).rejects.toThrow("Route crashed");

    await new Promise((r) => setTimeout(r, 10));
    // Analytics was attempted even though it failed
    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
  });
});


describe("instrumentRouteModule", () => {
  const mockNeonClient = { sql: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordEvent.mockResolvedValue({ success: true });
  });

  it("instruments all HTTP method handlers in a route module", async () => {
    const routeModule = {
      GET: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      POST: vi.fn().mockResolvedValue(new Response(null, { status: 201 })),
    };

    const instrumented = instrumentRouteModule("/api/test", routeModule, mockNeonClient);

    expect(typeof instrumented.GET).toBe("function");
    expect(typeof instrumented.POST).toBe("function");

    await instrumented.GET(new Request("http://localhost/api/test"));
    await instrumented.POST(new Request("http://localhost/api/test", { method: "POST" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRecordEvent).toHaveBeenCalledTimes(2);
  });

  it("skips non-function and non-HTTP-method keys", () => {
    const routeModule = {
      GET: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      customHelper: () => "not a handler",
      config: { maxDuration: 10 },
    };

    const instrumented = instrumentRouteModule("/api/test", routeModule, mockNeonClient);

    expect(typeof instrumented.GET).toBe("function");
    expect(instrumented.customHelper).toBeUndefined();
    expect(instrumented.config).toBeUndefined();
  });
});
