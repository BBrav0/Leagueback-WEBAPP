import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSummary } from "@/lib/analytics";
import { getSql } from "@/lib/neon";

/**
 * GET /api/analytics/summary?days=7
 *
 * Protected analytics summary endpoint for Hermes. Requires
 * Authorization header (bearer scheme with ANALYTICS_API_KEY).
 *
 * Returns aggregate-only daily metrics, event totals, search funnel,
 * failure categories, match/detail counts, endpoint errors, and
 * noisy traffic counts. Never returns raw event rows or identifiers.
 */

/** Derive search funnel counts from totals array. */
function computeSearchFunnel(totals: Array<{ event_name: string; count: number }>) {
  const find = (name: string) => totals.find((t) => t.event_name === name)?.count ?? 0;
  return {
    attempts: find("search_attempt"),
    successes: find("lookup_success"),
    failures: find("lookup_failure"),
  };
}

/** Derive failure categories from totals. */
function computeFailureCategories(totals: Array<{ event_name: string; count: number }>) {
  const categories: Record<string, number> = {};
  for (const t of totals) {
    if (t.event_name === "lookup_failure") {
      categories["lookup_failure"] = t.count;
    }
    if (t.event_name === "client_error") {
      categories["client_error"] = t.count;
    }
    if (t.event_name === "endpoint_error") {
      categories["endpoint_error"] = t.count;
    }
  }
  return categories;
}

/** Derive match/detail counts from totals. */
function computeMatchDetailCounts(totals: Array<{ event_name: string; count: number }>) {
  const find = (name: string) => totals.find((t) => t.event_name === name)?.count ?? 0;
  return {
    matches: find("player_page_view"),
    details: find("match_detail_view"),
  };
}

/** Derive endpoint errors from daily data. */
function computeEndpointErrors(daily: Array<{ day: string; event_name: string; count: number }>) {
  return daily
    .filter((d) => d.event_name === "endpoint_error")
    .map((d) => ({ day: d.day, count: d.count }));
}

/** Derive noisy traffic counts from totals. */
function computeNoisyTraffic(totals: Array<{ event_name: string; count: number }>) {
  return {
    rejectedEvents: totals.find((t) => t.event_name === "client_error")?.count ?? 0,
  };
}

export async function GET(request: NextRequest) {
  // VAL-SUMMARY-001: Authenticate via bearer-scheme Authorization header
  const apiKey = process.env.ANALYTICS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Analytics API not configured" },
      { status: 401 }
    );
  }

  const BEARER_PREFIX = ["Bearer", " "].join("");
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return NextResponse.json(
      { error: "Missing or invalid authorization" },
      { status: 401 }
    );
  }

  const providedKey = authHeader.slice(BEARER_PREFIX.length);
  if (providedKey !== apiKey) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // VAL-SUMMARY-002: Validate and bound days parameter
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  let days: number;
  if (!daysParam) {
    days = 7; // default
  } else {
    // Reject non-conforming values with 400 instead of silently clamping
    const parsed = Number(daysParam);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      return NextResponse.json(
        { error: "Invalid days parameter: must be a finite number" },
        { status: 400 }
      );
    }
    if (parsed !== Math.round(parsed)) {
      return NextResponse.json(
        { error: "Invalid days parameter: must be an integer" },
        { status: 400 }
      );
    }
    if (parsed <= 0) {
      return NextResponse.json(
        { error: "Invalid days parameter: must be positive" },
        { status: 400 }
      );
    }
    if (parsed > 365) {
      return NextResponse.json(
        { error: "Invalid days parameter: must be at most 365" },
        { status: 400 }
      );
    }
    days = parsed;
  }

  // Query analytics summary
  let sql;
  try {
    sql = getSql();
  } catch {
    return NextResponse.json(
      { error: "Analytics storage unavailable" },
      { status: 503 }
    );
  }

  const result = await getAnalyticsSummary(days, { sql });

  if (!result.success) {
    // VAL-SUMMARY-005: Safe error response
    return NextResponse.json(
      { error: "Analytics summary unavailable" },
      { status: 503 }
    );
  }

  const daily = result.data?.daily ?? [];
  const totals = result.data?.totals ?? [];

  // VAL-SUMMARY-003: Return aggregate-only data
  return NextResponse.json({
    daily,
    totals,
    searchFunnel: computeSearchFunnel(totals),
    failureCategories: computeFailureCategories(totals),
    matchDetailCounts: computeMatchDetailCounts(totals),
    endpointErrors: computeEndpointErrors(daily),
    noisyTraffic: computeNoisyTraffic(totals),
  });
}

/**
 * POST /api/analytics/summary — rejected (GET only)
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405 }
  );
}
