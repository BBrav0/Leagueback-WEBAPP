/**
 * VAL-CLIENT-008: Dashboard/hook-level analytics wiring tests.
 *
 * These tests verify the useAnalytics hook correctly delegates each
 * dashboard interaction to the corresponding analytics-client function.
 * This provides hook-level evidence beyond the helper-only tests in
 * lib/analytics-client.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock analytics-client — use vi.hoisted to allow vi.mock factory to reference them
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
// Mock React so the hook can be executed in a node test environment
// ---------------------------------------------------------------------------

vi.mock("react", () => ({
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (fn: (...args: unknown[]) => unknown) => fn,
  useEffect: (fn: () => void) => {
    // Execute effect immediately in test
    fn();
  },
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

describe("VAL-CLIENT-008: useAnalytics hook wires dashboard interactions correctly", () => {
  it("initializes analytics session on first call", () => {
    useAnalytics();
    expect(mockInitAnalyticsSession).toHaveBeenCalledTimes(1);
  });

  // --- Search submit ---

  it("onSearchAttempt delegates to trackSearchAttempt with gameName and tagLine", () => {
    const { onSearchAttempt } = useAnalytics();
    onSearchAttempt("TestPlayer", "EUW1");
    expect(mockTrackSearchAttempt).toHaveBeenCalledTimes(1);
    expect(mockTrackSearchAttempt).toHaveBeenCalledWith("TestPlayer", "EUW1");
  });

  // --- Lookup success ---

  it("onLookupSuccess delegates to trackLookupSuccess with matchCount", () => {
    const { onLookupSuccess } = useAnalytics();
    onLookupSuccess(15);
    expect(mockTrackLookupSuccess).toHaveBeenCalledTimes(1);
    expect(mockTrackLookupSuccess).toHaveBeenCalledWith({ matchCount: 15 });
  });

  // --- Lookup failure ---

  it("onLookupFailure delegates to trackLookupFailure with category and rawMessage", () => {
    const { onLookupFailure } = useAnalytics();
    onLookupFailure("account_not_found", "Player not found");
    expect(mockTrackLookupFailure).toHaveBeenCalledTimes(1);
    expect(mockTrackLookupFailure).toHaveBeenCalledWith("account_not_found", "Player not found");
  });

  it("onLookupFailure delegates to trackLookupFailure without rawMessage", () => {
    const { onLookupFailure } = useAnalytics();
    onLookupFailure("server_error");
    expect(mockTrackLookupFailure).toHaveBeenCalledTimes(1);
    expect(mockTrackLookupFailure).toHaveBeenCalledWith("server_error", undefined);
  });

  // --- Match card expansion ---

  it("onMatchDetailView delegates to trackMatchDetailView with matchId", () => {
    const { onMatchDetailView } = useAnalytics();
    onMatchDetailView("NA1_1234567890");
    expect(mockTrackMatchDetailView).toHaveBeenCalledTimes(1);
    expect(mockTrackMatchDetailView).toHaveBeenCalledWith("NA1_1234567890");
  });

  // --- Load more ---

  it("onLoadMore delegates to trackLoadMore with context", () => {
    const { onLoadMore } = useAnalytics();
    onLoadMore({ offset: 20, limit: 20, source: "stored-history" });
    expect(mockTrackLoadMore).toHaveBeenCalledTimes(1);
    expect(mockTrackLoadMore).toHaveBeenCalledWith({
      offset: 20,
      limit: 20,
      source: "stored-history",
    });
  });

  // --- Manual update ---

  it("onManualUpdate delegates to trackManualUpdate with outcome", () => {
    const { onManualUpdate } = useAnalytics();
    onManualUpdate("success");
    expect(mockTrackManualUpdate).toHaveBeenCalledTimes(1);
    expect(mockTrackManualUpdate).toHaveBeenCalledWith({ outcome: "success" });
  });

  it("onManualUpdate with rate_limited outcome delegates correctly", () => {
    const { onManualUpdate } = useAnalytics();
    onManualUpdate("rate_limited");
    expect(mockTrackManualUpdate).toHaveBeenCalledWith({ outcome: "rate_limited" });
  });

  it("onManualUpdate with error outcome delegates correctly", () => {
    const { onManualUpdate } = useAnalytics();
    onManualUpdate("error");
    expect(mockTrackManualUpdate).toHaveBeenCalledWith({ outcome: "error" });
  });

  // --- Client error ---

  it("onClientError delegates to trackClientError with category", () => {
    const { onClientError } = useAnalytics();
    onClientError("fetch_failure");
    expect(mockTrackClientError).toHaveBeenCalledTimes(1);
    expect(mockTrackClientError).toHaveBeenCalledWith("fetch_failure", undefined);
  });

  it("onClientError delegates to trackClientError with category and context", () => {
    const { onClientError } = useAnalytics();
    onClientError("parse_error", { route: "/api/match-performance" });
    expect(mockTrackClientError).toHaveBeenCalledTimes(1);
    expect(mockTrackClientError).toHaveBeenCalledWith("parse_error", {
      route: "/api/match-performance",
    });
  });

  // --- Page view ---

  it("trackPageViewOnce delegates to trackPageView for non-player routes", () => {
    mockSanitizeClientPath.mockReturnValue("/dashboard");
    const { trackPageViewOnce } = useAnalytics();
    trackPageViewOnce("/dashboard");
    expect(mockTrackPageView).toHaveBeenCalledTimes(1);
    expect(mockTrackPageView).toHaveBeenCalledWith("/dashboard");
    expect(mockTrackPlayerPageView).not.toHaveBeenCalled();
  });

  it("trackPageViewOnce delegates to trackPlayerPageView for /player routes", () => {
    mockSanitizeClientPath.mockReturnValue("/player");
    const { trackPageViewOnce } = useAnalytics();
    trackPageViewOnce("/player/TestPlayer/EUW1");
    expect(mockTrackPlayerPageView).toHaveBeenCalledTimes(1);
    expect(mockTrackPlayerPageView).toHaveBeenCalledWith("/player/TestPlayer/EUW1");
    expect(mockTrackPageView).not.toHaveBeenCalled();
  });

  // --- Return shape ---

  it("returns all expected interaction callbacks", () => {
    const result = useAnalytics();
    expect(result).toHaveProperty("trackPageViewOnce");
    expect(result).toHaveProperty("onSearchAttempt");
    expect(result).toHaveProperty("onLookupSuccess");
    expect(result).toHaveProperty("onLookupFailure");
    expect(result).toHaveProperty("onMatchDetailView");
    expect(result).toHaveProperty("onLoadMore");
    expect(result).toHaveProperty("onManualUpdate");
    expect(result).toHaveProperty("onClientError");
    // All should be functions
    expect(typeof result.trackPageViewOnce).toBe("function");
    expect(typeof result.onSearchAttempt).toBe("function");
    expect(typeof result.onLookupSuccess).toBe("function");
    expect(typeof result.onLookupFailure).toBe("function");
    expect(typeof result.onMatchDetailView).toBe("function");
    expect(typeof result.onLoadMore).toBe("function");
    expect(typeof result.onManualUpdate).toBe("function");
    expect(typeof result.onClientError).toBe("function");
  });
});
