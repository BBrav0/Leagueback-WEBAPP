import { NextRequest, NextResponse } from "next/server";
import {
  recordAnalyticsEvent,
  validateEventName,
  validateVisitorId,
  validateSessionId,
  sanitizeProperties,
} from "@/lib/analytics";
import { getSql } from "@/lib/neon";

/**
 * POST /api/analytics/ingest
 *
 * Accepts valid browser analytics events and returns a non-sensitive
 * acknowledgement. Rejects malformed, unsupported, oversized, or
 * secret-like events with safe 4xx responses.
 *
 * Analytics storage failures never alter the response — always returns
 * ok:true for valid events even if the write fails (fail-open).
 */

export async function POST(request: NextRequest) {
  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Validate body shape
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { eventName, visitorId, sessionId, properties } = body as Record<string, unknown>;

  // Required fields
  if (typeof eventName !== "string" || !eventName) {
    return NextResponse.json(
      { error: "Missing or invalid eventName" },
      { status: 400 }
    );
  }

  if (typeof visitorId !== "string" || !validateVisitorId(visitorId)) {
    return NextResponse.json(
      { error: "Missing or invalid visitorId" },
      { status: 400 }
    );
  }

  if (typeof sessionId !== "string" || !validateSessionId(sessionId)) {
    return NextResponse.json(
      { error: "Missing or invalid sessionId" },
      { status: 400 }
    );
  }

  // Validate event name against allowlist
  if (!validateEventName(eventName)) {
    return NextResponse.json(
      { error: "Unsupported event name" },
      { status: 400 }
    );
  }

  // Sanitize properties (never write raw/secret-like properties)
  const sanitizedProps = sanitizeProperties(
    typeof properties === "object" && properties !== null && !Array.isArray(properties)
      ? properties
      : {}
  );

  // Record event (fail-open — storage failure does not affect response)
  try {
    const sql = getSql();
    await recordAnalyticsEvent(
      eventName,
      visitorId,
      sessionId,
      sanitizedProps,
      { sql }
    );
  } catch {
    // Fail-open: analytics storage failure is non-blocking
  }

  // Return non-sensitive acknowledgement
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/analytics/ingest — rejected (POST only)
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405 }
  );
}
