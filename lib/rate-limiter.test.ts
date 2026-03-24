// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("allows requests under the limit and tracks remaining", () => {
    const limiter = new RateLimiter(2, 60_000);

    const first = limiter.checkRateLimit();
    const second = limiter.checkRateLimit();

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });

  it("blocks when at the limit and includes retryAfter", () => {
    const limiter = new RateLimiter(1, 60_000);

    limiter.checkRateLimit();
    const blocked = limiter.checkRateLimit();

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(0);
  });

  it("expires old timestamps outside the window", () => {
    const limiter = new RateLimiter(1, 60_000);

    limiter.checkRateLimit();
    vi.advanceTimersByTime(60_001);
    vi.setSystemTime(new Date("2026-01-01T00:01:00.001Z"));

    const result = limiter.checkRateLimit();
    expect(result.allowed).toBe(true);
  });

  it("recovers from malformed storage JSON", () => {
    sessionStorage.setItem("rate_limiter_requests", "not-json");
    const limiter = new RateLimiter(2, 60_000);
    const result = limiter.getStatus();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("reset clears tracked requests", () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.checkRateLimit();
    limiter.reset();
    const status = limiter.getStatus();
    expect(status.remaining).toBe(2);
  });
});
