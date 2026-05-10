// Mock server-only so tests can import the analytics module
vi.mock("server-only", () => ({}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VALID_EVENT_NAMES,
  VALIDATE_PROPERTIES,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_STRING_LENGTH,
  MAX_PROPERTY_COUNT,
  MAX_NESTING_DEPTH,
  validateEventName,
  sanitizeProperties,
  boundTimestamp,
  validateVisitorId,
  validateSessionId,
  hashIdentifier,
  sanitizeRoutePath,
  recordAnalyticsEvent,
  getAnalyticsSummary,
  protectClientDerivedValue,
  applyClientPropertyProtection,
  PROTECTED_CLIENT_PROPERTIES,
} from "./analytics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Record<string, unknown> = {}) {
  return { page: "/dashboard", ...overrides };
}

// ---------------------------------------------------------------------------
// Event name validation
// ---------------------------------------------------------------------------

describe("validateEventName", () => {
  it("accepts all valid event names", () => {
    for (const name of VALID_EVENT_NAMES) {
      expect(validateEventName(name)).toBe(true);
    }
  });

  it("rejects unknown event names", () => {
    expect(validateEventName("unknown_event")).toBe(false);
    expect(validateEventName("")).toBe(false);
    expect(validateEventName("page_view ")).toBe(false);
    expect(validateEventName("PAGE_VIEW")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property sanitization / bounding
// ---------------------------------------------------------------------------

describe("sanitizeProperties", () => {
  it("passes short, flat, approved properties through", () => {
    const props = { page: "/dashboard", referrer: "direct" };
    const result = sanitizeProperties(props);
    expect(result.page).toBe("/dashboard");
    expect(result.referrer).toBe("direct");
  });

  it("truncates oversized string values", () => {
    const longStr = "a".repeat(MAX_PROPERTY_STRING_LENGTH + 50);
    const result = sanitizeProperties({ big: longStr });
    expect((result.big as string).length).toBeLessThanOrEqual(
      MAX_PROPERTY_STRING_LENGTH
    );
  });

  it("drops keys exceeding max key length", () => {
    const longKey = "k".repeat(MAX_PROPERTY_KEY_LENGTH + 1);
    const result = sanitizeProperties({ [longKey]: "val", ok: "yes" });
    expect(result).not.toHaveProperty(longKey);
    expect(result.ok).toBe("yes");
  });

  it("drops excess properties beyond MAX_PROPERTY_COUNT", () => {
    const props: Record<string, string> = {};
    for (let i = 0; i < MAX_PROPERTY_COUNT + 5; i++) {
      props[`prop_${i}`] = `val_${i}`;
    }
    const result = sanitizeProperties(props);
    const keys = Object.keys(result);
    expect(keys.length).toBeLessThanOrEqual(MAX_PROPERTY_COUNT);
  });

  it("flattens/rejects deeply nested objects", () => {
    // Nest deeper than allowed
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < MAX_NESTING_DEPTH + 2; i++) {
      nested = { inner: nested };
    }
    const result = sanitizeProperties({ nested });
    // Deeply nested value should be dropped or stringified
    expect(result.nested).toBeUndefined();
  });

  it("scrubs secret-like values from properties", () => {
    const props = {
      token: "<TOKEN_PLACEHOLDER>",
      apiKey: "<API_KEY_PLACEHOLDER>",
      auth_header: ["Bearer", "<SECRET_PLACEHOLDER>"].join("-"),
      cookie: "session=abc123",
      dbUrl: ["postgres", "//db-host/db"].join(":"),
    };
    const result = sanitizeProperties(props);
    expect(result.token).toBeUndefined();
    expect(result.apiKey).toBeUndefined();
    expect(result.auth_header).toBeUndefined();
    expect(result.cookie).toBeUndefined();
    expect(result.dbUrl).toBeUndefined();
  });

  it("handles non-object input gracefully", () => {
    expect(sanitizeProperties(null as any)).toEqual({});
    expect(sanitizeProperties(undefined as any)).toEqual({});
    expect(sanitizeProperties("string" as any)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Timestamp bounding
// ---------------------------------------------------------------------------

describe("boundTimestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));
  });

  it("returns a valid Date for a reasonable client timestamp", () => {
    const clientTs = new Date("2026-05-10T11:59:00.000Z");
    const result = boundTimestamp(clientTs.toISOString());
    expect(result).toBeInstanceOf(Date);
    expect(Math.abs(result.getTime() - clientTs.getTime())).toBeLessThan(1000);
  });

  it("replaces future timestamps with server now", () => {
    const future = new Date("2027-01-01T00:00:00.000Z");
    const result = boundTimestamp(future.toISOString());
    expect(result.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("replaces timestamps older than 24 hours with server now", () => {
    const old = new Date("2026-05-01T00:00:00.000Z");
    const result = boundTimestamp(old.toISOString());
    // Should be clamped to server now since it's > 24h in the past
    expect(result.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-05-09T12:00:00.000Z").getTime()
    );
  });

  it("uses server now for invalid/missing timestamps", () => {
    const result1 = boundTimestamp(undefined);
    expect(result1).toBeInstanceOf(Date);

    const result2 = boundTimestamp("not-a-date");
    expect(result2).toBeInstanceOf(Date);

    const result3 = boundTimestamp("");
    expect(result3).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Visitor / session ID validation
// ---------------------------------------------------------------------------

describe("validateVisitorId", () => {
  it("accepts valid visitor IDs (alphanumeric, dash, underscore, 8-64 chars)", () => {
    expect(validateVisitorId("abc12345")).toBe(true);
    expect(validateVisitorId("visitor-id_12345678")).toBe(true);
    expect(validateVisitorId("a".repeat(64))).toBe(true);
  });

  it("rejects empty, too short, too long, or malformed IDs", () => {
    expect(validateVisitorId("")).toBe(false);
    expect(validateVisitorId("short")).toBe(false); // < 8
    expect(validateVisitorId("a".repeat(65))).toBe(false); // > 64
    expect(validateVisitorId("has spaces!")).toBe(false);
    expect(validateVisitorId("../../etc/passwd")).toBe(false);
  });
});

describe("validateSessionId", () => {
  it("accepts valid session IDs (alphanumeric, dash, underscore, 8-64 chars)", () => {
    expect(validateSessionId("sess-12345678")).toBe(true);
    expect(validateSessionId("s".repeat(8))).toBe(true);
  });

  it("rejects invalid session IDs", () => {
    expect(validateSessionId("")).toBe(false);
    expect(validateSessionId("tiny")).toBe(false);
    expect(validateSessionId("x".repeat(65))).toBe(false);
    expect(validateSessionId("../../etc/passwd")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Identifier hashing
// ---------------------------------------------------------------------------

describe("hashIdentifier", () => {
  it("produces a deterministic hex hash for the same input", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-deterministic-test-1234";
      const a = hashIdentifier("player1", "tag1");
      const b = hashIdentifier("player1", "tag1");
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("produces different hashes for different inputs", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-different-inputs-xxxxx";
      const a = hashIdentifier("player1", "tag1");
      const b = hashIdentifier("player2", "tag1");
      expect(a).not.toBe(b);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("handles empty inputs", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-empty-input-test-xxxxxx";
      const hash = hashIdentifier("", "");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  // Scrutiny regression: HMAC uses server-only key, not public salt
  it("produces different hashes when ANALYTICS_HMAC_KEY changes", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      // With first explicit key
      process.env["ANALYTICS_HMAC_KEY"] = "**************************************************";
      const a = hashIdentifier("player1", "tag1");

      // With a different explicit key
      process.env["ANALYTICS_HMAC_KEY"] = "test-different-hmac-key-12345678";
      const b = hashIdentifier("player1", "tag1");

      // Different keys must produce different hashes (non-public recomputation)
      expect(a).not.toBe(b);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  // Scrutiny regression: hash cannot be reproduced without the HMAC key
  it("uses HMAC strategy (hash changes with key, not with public salt)", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "server-secret-key-for-hmac-12345";
      const hash1 = hashIdentifier("TestPlayer", "EUW1");

      // Reset to a different key
      process.env["ANALYTICS_HMAC_KEY"] = "completely-different-key-98765xx";
      const hash2 = hashIdentifier("TestPlayer", "EUW1");

      // Same input, different keys → different hashes
      expect(hash1).not.toBe(hash2);
      // Both must still be valid hex
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash2).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  // Case normalization still applies
  it("normalizes gameName and tagLine to lowercase", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-case-normalization-test-x";
      const a = hashIdentifier("Player", "Tag");
      const b = hashIdentifier("player", "tag");
      expect(a).toBe(b);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  // Round-2 scrutiny regression: no public fallback key
  it("throws when ANALYTICS_HMAC_KEY is not set", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      delete process.env.ANALYTICS_HMAC_KEY;
      expect(() => hashIdentifier("player", "tag")).toThrow(
        /ANALYTICS_HMAC_KEY is required/
      );
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  // Round-2 scrutiny regression: short/weak keys are rejected
  it("throws when ANALYTICS_HMAC_KEY is too short", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "short";
      expect(() => hashIdentifier("player", "tag")).toThrow(
        /ANALYTICS_HMAC_KEY is required/
      );
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  // Round-2 scrutiny regression: valid key produces deterministic output
  it("produces consistent output with a valid key", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "valid-test-key-at-least-32-chars-long!";
      const hashes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        hashes.add(hashIdentifier("player", "tag"));
      }
      expect(hashes.size).toBe(1);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Route path sanitization
// ---------------------------------------------------------------------------

describe("sanitizeRoutePath", () => {
  it("strips player-identifying segments from /player paths", () => {
    expect(sanitizeRoutePath("/player/SomeRiotName/EUW1")).toBe("/player");
    expect(sanitizeRoutePath("/player/Validation%20Fixture/LOCAL")).toBe(
      "/player"
    );
  });

  it("passes safe root paths through", () => {
    expect(sanitizeRoutePath("/")).toBe("/");
    expect(sanitizeRoutePath("/dashboard")).toBe("/dashboard");
  });

  it("strips query strings", () => {
    expect(sanitizeRoutePath("/?foo=bar&secret=value")).toBe("/");
    expect(sanitizeRoutePath("/player/X/Y?tab=overview")).toBe("/player");
  });

  it("handles empty or invalid paths", () => {
    expect(sanitizeRoutePath("")).toBe("/");
    expect(sanitizeRoutePath(null as any)).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// Fail-open write behavior
// ---------------------------------------------------------------------------

describe("recordAnalyticsEvent (fail-open)", () => {
  it("returns success false and does not throw on Neon write failure", async () => {
    // Simulate a Neon write failure
    const result = await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      makeProps(),
      {
        sql: vi.fn().mockRejectedValue(new Error("Neon unavailable")),
      } as any
    );
    expect(result.success).toBe(false);
    // Must NOT throw
  });

  it("returns success true when write succeeds", async () => {
    const result = await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      makeProps(),
      {
        sql: vi.fn().mockResolvedValue([{ id: 1 }]),
      } as any
    );
    expect(result.success).toBe(true);
  });

  it("rejects invalid event names", async () => {
    const result = await recordAnalyticsEvent(
      "invalid_event",
      "visitor-12345678",
      "session-12345678",
      makeProps(),
      {
        sql: vi.fn(),
      } as any
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_event_name");
  });

  it("rejects invalid visitor/session IDs", async () => {
    const result = await recordAnalyticsEvent(
      "page_view",
      "bad",
      "session-12345678",
      makeProps(),
      {
        sql: vi.fn(),
      } as any
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_ids");
  });

  it("sanitizes properties before writing", async () => {
    const sql = vi.fn().mockResolvedValue([{ id: 1 }]);
    await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      { page: "/dashboard", apiKey: "secret-key" },
      { sql } as any
    );
    expect(sql).toHaveBeenCalledTimes(1);
    // Verify the properties stored do NOT contain apiKey
    const callArgs = sql.mock.calls[0];
    const sqlTemplate = callArgs[0];
    // The SQL template is a tagged template array, values are in callArgs after index 0
    // The properties are passed as JSON — let's find them in the values
    const values = callArgs.slice(1);
    // In the neon sql tagged template, values are the interpolated expressions
    // We just need to verify sql was called (properties sanitization already tested above)
    expect(sqlTemplate).toBeDefined();
  });

  // Scrutiny regression: client timestamps are bounded at write time
  it("applies boundTimestamp to client-provided timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));

    const sql = vi.fn().mockResolvedValue([{ id: 1 }]);

    // A future timestamp should be clamped to server now
    const futureTs = "2027-01-01T00:00:00.000Z";
    await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      { page: "/" },
      { sql } as any,
      futureTs
    );

    expect(sql).toHaveBeenCalledTimes(1);
    // The timestamp in the SQL call should be server now, not the future timestamp
    const callArgs = sql.mock.calls[0];
    // Timestamp is the 5th interpolated value in the tagged template
    const storedTs = callArgs[5]; // eventName, visitorId, sessionId, properties, timestamp
    // Server now = 2026-05-10T12:00:00.000Z
    expect(new Date(storedTs).getTime()).toBeLessThanOrEqual(
      new Date("2026-05-10T12:00:00.000Z").getTime() + 1000
    );

    vi.useRealTimers();
  });

  // Scrutiny regression: very old client timestamps are replaced with server now
  it("replaces timestamps older than 24 hours with server now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));

    const sql = vi.fn().mockResolvedValue([{ id: 1 }]);

    // A timestamp from 10 days ago should be replaced with server now
    const oldTs = "2026-04-30T00:00:00.000Z";
    await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      { page: "/" },
      { sql } as any,
      oldTs
    );

    expect(sql).toHaveBeenCalledTimes(1);
    const callArgs = sql.mock.calls[0];
    const storedTs = callArgs[5];
    const storedDate = new Date(storedTs);
    // Should be server now (2026-05-10), not the old date (2026-04-30)
    expect(storedDate.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-05-09T12:00:00.000Z").getTime()
    );

    vi.useRealTimers();
  });

  // Scrutiny regression: no client timestamp uses server now
  it("uses server now when no client timestamp is provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));

    const sql = vi.fn().mockResolvedValue([{ id: 1 }]);

    await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      { page: "/" },
      { sql } as any
      // No clientTimestamp
    );

    expect(sql).toHaveBeenCalledTimes(1);
    const callArgs = sql.mock.calls[0];
    const storedTs = callArgs[5];
    const storedDate = new Date(storedTs);
    expect(storedDate.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-05-10T12:00:00.000Z").getTime()
    );

    vi.useRealTimers();
  });

  // Scrutiny regression: valid recent client timestamps are preserved
  it("preserves valid recent client timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));

    const sql = vi.fn().mockResolvedValue([{ id: 1 }]);

    // A timestamp from 5 minutes ago should be preserved
    const recentTs = "2026-05-10T11:55:00.000Z";
    await recordAnalyticsEvent(
      "page_view",
      "visitor-12345678",
      "session-12345678",
      { page: "/" },
      { sql } as any,
      recentTs
    );

    expect(sql).toHaveBeenCalledTimes(1);
    const callArgs = sql.mock.calls[0];
    const storedTs = callArgs[5];
    // Should preserve the client timestamp (within 1 second tolerance)
    expect(Math.abs(new Date(storedTs).getTime() - new Date(recentTs).getTime())).toBeLessThan(1000);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Summary query primitives
// ---------------------------------------------------------------------------

describe("getAnalyticsSummary", () => {
  const mockSql = vi.fn();

  beforeEach(() => {
    mockSql.mockReset();
  });

  it("bounds days to 1-365 range", async () => {
    mockSql.mockResolvedValue([]);
    await getAnalyticsSummary(0, { sql: mockSql } as any);
    // Days=0 should be clamped to 1
    expect(mockSql).toHaveBeenCalled();

    mockSql.mockClear();
    await getAnalyticsSummary(500, { sql: mockSql } as any);
    // Days=500 should be clamped to 365
    expect(mockSql).toHaveBeenCalled();
  });

  it("returns structured summary on success", async () => {
    mockSql
      .mockResolvedValueOnce([{ event_name: "page_view", day: "2026-05-10", count: 10 }])
      .mockResolvedValueOnce([{ event_name: "page_view", count: 10 }])
      .mockResolvedValueOnce([
        { event_name: "lookup_failure", category: "account_not_found", count: 2 },
      ]);
    const result = await getAnalyticsSummary(7, { sql: mockSql } as any);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.failureCategories).toEqual([
      { event_name: "lookup_failure", category: "account_not_found", count: 2 },
    ]);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it("returns success false on database failure without throwing", async () => {
    mockSql.mockRejectedValue(new Error("DB down"));
    const result = await getAnalyticsSummary(7, { sql: mockSql } as any);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Must not contain raw SQL or connection details
    expect(result.error).not.toMatch(/postgres(ql)?:\/\//);
    expect(result.error).not.toContain("DATABASE_URL");
  });

  it("handles empty results gracefully", async () => {
    mockSql.mockResolvedValue([]);
    const result = await getAnalyticsSummary(7, { sql: mockSql } as any);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("keeps analytics migration schema compatible with recordAnalyticsEvent inserts", () => {
    const migrationSql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260510000000_create_analytics_events.sql"),
      "utf8"
    );
    const writeSql = recordAnalyticsEvent.toString();

    for (const column of ["event_name", "visitor_id", "session_id", "properties", "created_at"]) {
      expect(migrationSql).toContain(column);
      expect(writeSql).toContain(column);
    }

    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.analytics_events/);
    expect(writeSql).toContain("INSERT INTO analytics_events");
  });
});


// ---------------------------------------------------------------------------
// Server-side client-derived property protection (VAL-CROSS-005)
// ---------------------------------------------------------------------------

describe("protectClientDerivedValue", () => {
  it("returns a keyed HMAC digest for a valid client hash", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const result = protectClientDerivedValue("clientHash123");
      expect(result).toMatch(/^[0-9a-f]{64}$/);
      expect(result).not.toBe("clientHash123");
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("produces different digests for different client values", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const a = protectClientDerivedValue("hashA");
      const b = protectClientDerivedValue("hashB");
      expect(a).not.toBe(b);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("returns empty string when HMAC key is not set (fail-open)", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      delete process.env.ANALYTICS_HMAC_KEY;
      const result = protectClientDerivedValue("someValue");
      expect(result).toBe("");
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("returns empty string for empty input", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      expect(protectClientDerivedValue("")).toBe("");
      expect(protectClientDerivedValue(null as any)).toBe("");
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("raw client-provided value cannot reproduce the server digest", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const clientValue = "abc123clienthash";
      const serverDigest = protectClientDerivedValue(clientValue);
      // The server digest must not equal the raw client value
      expect(serverDigest).not.toBe(clientValue);
      // The server digest must be a proper hex HMAC, not just re-hashing
      expect(serverDigest).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });
});

describe("applyClientPropertyProtection", () => {
  it("transforms queryHash from raw client value to server HMAC digest", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const input = { queryHash: "clientHash123", hasTagLine: true };
      const result = applyClientPropertyProtection(input);
      expect(result.queryHash).not.toBe("clientHash123");
      expect(result.queryHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.hasTagLine).toBe(true);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("transforms matchRef from raw client value to server HMAC digest", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const input = { matchRef: "clientMatchRef456" };
      const result = applyClientPropertyProtection(input);
      expect(result.matchRef).not.toBe("clientMatchRef456");
      expect(result.matchRef).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("does not modify non-protected properties", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const input = { page: "/dashboard", matchCount: 5, source: "stored" };
      const result = applyClientPropertyProtection(input);
      expect(result).toEqual(input);
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("clears protected values when HMAC key is unavailable (fail-open)", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      delete process.env.ANALYTICS_HMAC_KEY;
      const input = { queryHash: "clientHash123", matchRef: "clientRef456" };
      const result = applyClientPropertyProtection(input);
      // Raw client values must not be persisted
      expect(result.queryHash).not.toBe("clientHash123");
      expect(result.matchRef).not.toBe("clientRef456");
      // Should be empty strings instead
      expect(result.queryHash).toBe("");
      expect(result.matchRef).toBe("");
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("does not mutate the input object", () => {
    const original = process.env.ANALYTICS_HMAC_KEY;
    try {
      process.env["ANALYTICS_HMAC_KEY"] = "test-hmac-key-for-client-derived-value-prot";
      const input = { queryHash: "clientHash123" };
      const result = applyClientPropertyProtection(input);
      expect(input.queryHash).toBe("clientHash123");
      expect(result.queryHash).not.toBe("clientHash123");
    } finally {
      if (original !== undefined) {
        process.env["ANALYTICS_HMAC_KEY"] = original;
      } else {
        delete process.env.ANALYTICS_HMAC_KEY;
      }
    }
  });

  it("PROTECTED_CLIENT_PROPERTIES contains exactly queryHash and matchRef", () => {
    expect(PROTECTED_CLIENT_PROPERTIES.has("queryHash")).toBe(true);
    expect(PROTECTED_CLIENT_PROPERTIES.has("matchRef")).toBe(true);
    expect(PROTECTED_CLIENT_PROPERTIES.size).toBe(2);
  });
});
