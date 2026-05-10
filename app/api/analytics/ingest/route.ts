import { NextRequest, NextResponse } from "next/server";
import {
  recordAnalyticsEvent,
  validateEventName,
  validateVisitorId,
  validateSessionId,
  sanitizeProperties,
  isSecretKey,
  isWithinNestingDepth,
  isBrowserEvent,
  filterPropertiesByEvent,
  applyClientPropertyProtection,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_COUNT,
  MAX_NESTING_DEPTH,
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

  // Reject server-only events from public ingest (VAL-API-005)
  if (!isBrowserEvent(eventName)) {
    return NextResponse.json(
      { error: "Server-only event" },
      { status: 400 }
    );
  }

  // Validate properties shape before any write:
  // Reject secret-like keys, oversized keys, too many properties, and deeply nested values.
  // This prevents bad payloads from reaching recordAnalyticsEvent.
  const rawProps =
    typeof properties === "object" && properties !== null && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)
      : {};

  // Check for secret-like keys — reject entire request
  if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
    for (const key of Object.keys(properties as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        return NextResponse.json(
          { error: "Unsupported property" },
          { status: 400 }
        );
      }
    }
  }

  // Check for oversized keys — reject
  for (const key of Object.keys(rawProps)) {
    if (key.length > MAX_PROPERTY_KEY_LENGTH) {
      return NextResponse.json(
        { error: "Property key too long" },
        { status: 400 }
      );
    }
  }

  // Check for too many properties — reject
  if (Object.keys(rawProps).length > MAX_PROPERTY_COUNT) {
    return NextResponse.json(
      { error: "Too many properties" },
      { status: 400 }
    );
  }

  // Check for deeply nested values — reject
  for (const value of Object.values(rawProps)) {
    if (typeof value === "object" && value !== null && !isWithinNestingDepth(value, MAX_NESTING_DEPTH)) {
      return NextResponse.json(
        { error: "Property nesting too deep" },
        { status: 400 }
      );
    }
  }

  // Sanitize properties (final safety pass — never write raw/secret-like properties)
  const sanitizedProps = sanitizeProperties(rawProps);

  // Filter to event-specific property allowlist (VAL-API-004)
  const filteredProps = filterPropertiesByEvent(eventName, sanitizedProps);

  // Apply server-side keyed protection to client-derived identifier references
  // (queryHash, matchRef) so raw client-provided values are never persisted.
  const protectedProps = applyClientPropertyProtection(filteredProps);

  // Record event (fail-open — storage failure does not affect response)
  try {
    const sql = getSql();
    await recordAnalyticsEvent(
      eventName,
      visitorId,
      sessionId,
      protectedProps,
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

/**
 * PUT /api/analytics/ingest — rejected (POST only)
 */
export async function PUT(_request: NextRequest) {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405 }
  );
}

/**
 * DELETE /api/analytics/ingest — rejected (POST only)
 */
export async function DELETE(_request: NextRequest) {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405 }
  );
}

/**
 * PATCH /api/analytics/ingest — rejected (POST only)
 */
export async function PATCH(_request: NextRequest) {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405 }
  );
}
