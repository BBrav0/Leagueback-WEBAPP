/**
 * @vitest-environment jsdom
 */
/**
 * VAL-CLIENT-008: Dashboard/hook-level analytics wiring tests.
 *
 * These tests verify the useAnalytics hook inside a real React runtime
 * using renderHook from @testing-library/react. React hook primitives
 * (useEffect, useRef, useCallback, useMemo) are NOT mocked — only the
 * analytics-client module is mocked so assertions can observe delegation.
 *
 * This provides realistic lifecycle evidence beyond helper-only tests.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock analytics-client — use vi.hoisted so the mock factory can reference them
// ---------------------------------------------------------------------------

const {
  mockTrackSearchAttempt,
  mockTrackLookupSuccess,
  mockTrackLookupFailure,
  mockTrackMatchDetailView,
  mockTrackLoadMore,
  mockTrackManualUpdate,
  mockTrackClientError,
  mockTrackPageView,
  mockTrackPlayerPageView,
  mockInitAnalyticsSession,
  mockSanitizeClientPath,
} = vi.hoisted(() => ({
  mockTrackSearchAttempt: vi.fn().mockResolvedValue(undefined),
  mockTrackLookupSuccess: vi.fn().mockResolvedValue(undefined),
  mockTrackLookupFailure: vi.fn().mockResolvedValue(undefined),
  mockTrackMatchDetailView: vi.fn().mockResolvedValue(undefined),
  mockTrackLoadMore: vi.fn().mockResolvedValue(undefined),
  mockTrackManualUpdate: vi.fn().mockResolvedValue(undefined),
  mockTrackClientError: vi.fn().mockResolvedValue(undefined),
  mockTrackPageView: vi.fn().mockResolvedValue(undefined),
  mockTrackPlayerPageView: vi.fn().mockResolvedValue(undefined),
  mockInitAnalyticsSession: vi.fn(),
  mockSanitizeClientPath: vi.fn((p: string) => p),
}));

vi.mock("@/lib/analytics-client", () => ({
  initAnalyticsSession: mockInitAnalyticsSession,
  trackSearchAttempt: mockTrackSearchAttempt,
  trackLookupSuccess: mockTrackLookupSuccess,
  trackLookupFailure: mockTrackLookupFailure,
  trackMatchDetailView: mockTrackMatchDetailView,
  trackLoadMore: mockTrackLoadMore,
  trackManualUpdate: mockTrackManualUpdate,
  trackClientError: mockTrackClientError,
  trackPageView: mockTrackPageView,
  trackPlayerPageView: mockTrackPlayerPageView,
  sanitizeClientPath: mockSanitizeClientPath,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useAnalytics } from "./use-analytics";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Mount & session initialization — real lifecycle
// ===========================================================================

describe("useAnalytics — mount and session initialization", () => {
  it("initializes analytics session exactly once on mount via useEffect", () => {
    renderHook(() => useAnalytics());
    expect(mockInitAnalyticsSession).toHaveBeenCalledTimes(1);
  });

  it("does not re-initialize session on re-render", () => {
    const { rerender } = renderHook(() => useAnalytics());

    // Re-render the same hook instance — effect deps are [], so effect should not re-fire
    rerender();
    expect(mockInitAnalyticsSession).toHaveBeenCalledTimes(1);
  });

  it("does not re-initialize session across multiple re-renders", () => {
    const { rerender } = renderHook(() => useAnalytics());

    rerender();
    rerender();
    rerender();

    expect(mockInitAnalyticsSession).toHaveBeenCalledTimes(1);
  });

  it("initializes independently for each mounted hook instance", () => {
    renderHook(() => useAnalytics());
    renderHook(() => useAnalytics());

    // Each instance gets its own useEffect invocation
    expect(mockInitAnalyticsSession).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Page-view deduping — requires real useRef persistence
// ===========================================================================

describe("useAnalytics — page-view deduping", () => {
  it("tracks a page view on first call for a given path", () => {
    mockSanitizeClientPath.mockReturnValue("/dashboard");
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.trackPageViewOnce("/dashboard");
    });

    expect(mockTrackPageView).toHaveBeenCalledTimes(1);
    expect(mockTrackPageView).toHaveBeenCalledWith("/dashboard");
  });

  it("dedupes identical sanitized page views (does not re-track)", () => {
    mockSanitizeClientPath.mockReturnValue("/dashboard");
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.trackPageViewOnce("/dashboard");
      result.current.trackPageViewOnce("/dashboard");
      result.current.trackPageViewOnce("/dashboard");
    });

    // Only the first call should fire
    expect(mockTrackPageView).toHaveBeenCalledTimes(1);
  });

  it("tracks a new page view when the sanitized path changes", () => {
    mockSanitizeClientPath.mockImplementation((p: string) => {
      // Simple pass-through for test: sanitize by stripping query params
      if (p.startsWith("/player/")) return "/player";
      return p;
    });

    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.trackPageViewOnce("/dashboard");
    });
    expect(mockTrackPageView).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.trackPageViewOnce("/player/SomePlayer/EUW1");
    });
    expect(mockTrackPlayerPageView).toHaveBeenCalledTimes(1);

    // Total calls: one page_view + one player_page_view
    expect(mockTrackPageView).toHaveBeenCalledTimes(1);
    expect(mockTrackPlayerPageView).toHaveBeenCalledTimes(1);
  });

  it("uses trackPlayerPageView for /player sanitized paths", () => {
    mockSanitizeClientPath.mockReturnValue("/player");
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.trackPageViewOnce("/player/TestPlayer/EUW1");
    });

    expect(mockTrackPlayerPageView).toHaveBeenCalledTimes(1);
    expect(mockTrackPlayerPageView).toHaveBeenCalledWith("/player/TestPlayer/EUW1");
    expect(mockTrackPageView).not.toHaveBeenCalled();
  });

  it("dedupes player page views with same sanitized path", () => {
    mockSanitizeClientPath.mockReturnValue("/player");
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.trackPageViewOnce("/player/PlayerA/EUW1");
      result.current.trackPageViewOnce("/player/PlayerB/NA1");
    });

    // Second call has same sanitized path "/player" — should be deduped
    expect(mockTrackPlayerPageView).toHaveBeenCalledTimes(1);
  });

  it("tracks again after deduped path when a different path is tracked first", () => {
    mockSanitizeClientPath.mockImplementation((p: string) => p);
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.trackPageViewOnce("/a");
    });
    expect(mockTrackPageView).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.trackPageViewOnce("/a");
    });
    // Deduped — no additional call
    expect(mockTrackPageView).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.trackPageViewOnce("/b");
    });
    // New path — should track
    expect(mockTrackPageView).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Stable callback references — real useCallback memoization
// ===========================================================================

describe("useAnalytics — stable callback references", () => {
  it("returns the same callback references across re-renders", () => {
    const { result, rerender } = renderHook(() => useAnalytics());

    const firstRefs = { ...result.current };
    rerender();
    const secondRefs = { ...result.current };

    // All callbacks should be referentially stable (useCallback with [])
    expect(secondRefs.trackPageViewOnce).toBe(firstRefs.trackPageViewOnce);
    expect(secondRefs.onSearchAttempt).toBe(firstRefs.onSearchAttempt);
    expect(secondRefs.onLookupSuccess).toBe(firstRefs.onLookupSuccess);
    expect(secondRefs.onLookupFailure).toBe(firstRefs.onLookupFailure);
    expect(secondRefs.onMatchDetailView).toBe(firstRefs.onMatchDetailView);
    expect(secondRefs.onLoadMore).toBe(firstRefs.onLoadMore);
    expect(secondRefs.onManualUpdate).toBe(firstRefs.onManualUpdate);
    expect(secondRefs.onClientError).toBe(firstRefs.onClientError);
  });
});

// ===========================================================================
// Interaction wiring — search, lookup, match detail, load-more,
// manual update, client error
// ===========================================================================

describe("VAL-CLIENT-008: useAnalytics interaction wiring", () => {
  // --- Search submit ---

  it("onSearchAttempt delegates to trackSearchAttempt with gameName and tagLine", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onSearchAttempt("TestPlayer", "EUW1");
    });

    expect(mockTrackSearchAttempt).toHaveBeenCalledTimes(1);
    expect(mockTrackSearchAttempt).toHaveBeenCalledWith("TestPlayer", "EUW1");
  });

  // --- Lookup success ---

  it("onLookupSuccess delegates to trackLookupSuccess with matchCount", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onLookupSuccess(15);
    });

    expect(mockTrackLookupSuccess).toHaveBeenCalledTimes(1);
    expect(mockTrackLookupSuccess).toHaveBeenCalledWith({ matchCount: 15 });
  });

  // --- Lookup failure ---

  it("onLookupFailure delegates to trackLookupFailure with category and rawMessage", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onLookupFailure("account_not_found", "Player not found");
    });

    expect(mockTrackLookupFailure).toHaveBeenCalledTimes(1);
    expect(mockTrackLookupFailure).toHaveBeenCalledWith("account_not_found", "Player not found");
  });

  it("onLookupFailure delegates to trackLookupFailure without rawMessage", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onLookupFailure("server_error");
    });

    expect(mockTrackLookupFailure).toHaveBeenCalledTimes(1);
    expect(mockTrackLookupFailure).toHaveBeenCalledWith("server_error", undefined);
  });

  // --- Match card expansion ---

  it("onMatchDetailView delegates to trackMatchDetailView with matchId", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onMatchDetailView("NA1_1234567890");
    });

    expect(mockTrackMatchDetailView).toHaveBeenCalledTimes(1);
    expect(mockTrackMatchDetailView).toHaveBeenCalledWith("NA1_1234567890");
  });

  // --- Load more ---

  it("onLoadMore delegates to trackLoadMore with context", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onLoadMore({ offset: 20, limit: 20, source: "stored-history" });
    });

    expect(mockTrackLoadMore).toHaveBeenCalledTimes(1);
    expect(mockTrackLoadMore).toHaveBeenCalledWith({
      offset: 20,
      limit: 20,
      source: "stored-history",
    });
  });

  // --- Manual update ---

  it("onManualUpdate delegates to trackManualUpdate with success outcome", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onManualUpdate("success");
    });

    expect(mockTrackManualUpdate).toHaveBeenCalledTimes(1);
    expect(mockTrackManualUpdate).toHaveBeenCalledWith({ outcome: "success" });
  });

  it("onManualUpdate with rate_limited outcome delegates correctly", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onManualUpdate("rate_limited");
    });

    expect(mockTrackManualUpdate).toHaveBeenCalledWith({ outcome: "rate_limited" });
  });

  it("onManualUpdate with error outcome delegates correctly", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onManualUpdate("error");
    });

    expect(mockTrackManualUpdate).toHaveBeenCalledWith({ outcome: "error" });
  });

  // --- Client error ---

  it("onClientError delegates to trackClientError with category only", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onClientError("fetch_failure");
    });

    expect(mockTrackClientError).toHaveBeenCalledTimes(1);
    expect(mockTrackClientError).toHaveBeenCalledWith("fetch_failure", undefined);
  });

  it("onClientError delegates to trackClientError with category and context", () => {
    const { result } = renderHook(() => useAnalytics());

    act(() => {
      result.current.onClientError("parse_error", { route: "/api/match-performance" });
    });

    expect(mockTrackClientError).toHaveBeenCalledTimes(1);
    expect(mockTrackClientError).toHaveBeenCalledWith("parse_error", {
      route: "/api/match-performance",
    });
  });
});

// ===========================================================================
// Return shape
// ===========================================================================

describe("useAnalytics — return shape", () => {
  it("returns all expected interaction callbacks as functions", () => {
    const { result } = renderHook(() => useAnalytics());

    const keys = Object.keys(result.current);
    expect(keys).toContain("trackPageViewOnce");
    expect(keys).toContain("onSearchAttempt");
    expect(keys).toContain("onLookupSuccess");
    expect(keys).toContain("onLookupFailure");
    expect(keys).toContain("onMatchDetailView");
    expect(keys).toContain("onLoadMore");
    expect(keys).toContain("onManualUpdate");
    expect(keys).toContain("onClientError");

    // All should be functions
    for (const key of keys) {
      expect(typeof (result.current as Record<string, unknown>)[key]).toBe("function");
    }
  });
});
