import "server-only";

import { recordAnalyticsEvent, sanitizeRoutePath, sanitizeProperties } from "./analytics";

/**
 * Route instrumentation helper for API routes.
 *
 * Emits exactly one endpoint_outcome (or endpoint_error) event per request
 * without changing route status/body semantics. Analytics failures are
 * non-blocking (fail-open).
 */

/** Safe visitor/session IDs for server-side instrumentation. */
const SERVER_VISITOR_ID = "server-route-instrument";
const SERVER_SESSION_ID = "server-route-session-01";

/** Derives a failure category from HTTP status code. */
function failureCategory(status: number): string {
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500) return "server_error";
  return "unknown";
}

/** Status class string (2xx, 4xx, 5xx). */
function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500) return "5xx";
  return "unknown";
}

/** Neon SQL client shape. */
export interface NeonClient {
  sql: (...args: any[]) => Promise<any[]>;
}

/**
 * Instruments a route handler: wraps the handler, emits one analytics event
 * after the handler completes, and never allows analytics failures to affect
 * the route response.
 *
 * @param routeTemplate - Scrubbed route identifier (e.g., "/api/account")
 * @param handler - The original Next.js route handler
 * @param neonClientOrFactory - Either a NeonClient or a function that returns one (may throw)
 * @returns Wrapped handler with identical signature
 */
export function instrumentRoute<
  TReq extends Request = Request
>(
  routeTemplate: string,
  handler: (request: TReq) => Promise<Response>,
  neonClientOrFactory: NeonClient | (() => NeonClient)
): (request: TReq) => Promise<Response> {
  return async (request: TReq): Promise<Response> => {
    let response: Response;
    let thrownError: unknown = undefined;

    // Execute the original handler — catch throws so we can emit analytics
    // before re-throwing, preserving route error semantics.
    try {
      response = await handler(request);
    } catch (err: unknown) {
      thrownError = err;
      // Construct a synthetic 500 response for analytics purposes
      response = new Response(null, { status: 500 });
    }

    // Emit analytics event in background (fire-and-forget, fail-open)
    const status = response.status;
    const eventName = status >= 400 ? "endpoint_error" : "endpoint_outcome";

    const properties = sanitizeProperties({
      route: routeTemplate,
      method: request.method || "GET",
      status,
      statusClass: statusClass(status),
      ...(status >= 400 ? { failureCategory: thrownError ? "unhandled_exception" : failureCategory(status) } : {}),
    });

    // Resolve the neon client lazily — if factory throws (e.g. no DATABASE_URL),
    // silently skip the analytics write.
    let neonClient: NeonClient;
    try {
      neonClient = typeof neonClientOrFactory === "function"
        ? neonClientOrFactory()
        : neonClientOrFactory;
    } catch {
      // Cannot obtain a DB client — skip analytics, preserve route response
      if (thrownError !== undefined) throw thrownError;
      return response;
    }

    // Fire-and-forget — never await in a way that could throw to the caller
    recordAnalyticsEvent(
      eventName,
      SERVER_VISITOR_ID,
      SERVER_SESSION_ID,
      properties,
      neonClient
    ).catch(() => {
      // Suppress — analytics failure must never affect route behavior
    });

    // Re-throw the original error to preserve route error semantics
    if (thrownError !== undefined) throw thrownError;
    return response;
  };
}

/**
 * Creates an instrumented version of a Next.js App Router route object.
 * Supports GET, POST, PUT, DELETE, PATCH methods.
 *
 * @param routeTemplate - Scrubbed route identifier (e.g., "/api/account")
 * @param routeModule - Object with handler functions (GET, POST, etc.)
 * @param neonClientOrFactory - Either a NeonClient or a function that returns one (may throw)
 * @returns Object with instrumented handler functions
 */
export function instrumentRouteModule(
  routeTemplate: string,
  routeModule: Record<string, unknown>,
  neonClientOrFactory: NeonClient | (() => NeonClient)
): Record<string, Function> {
  const instrumented: Record<string, Function> = {};

  for (const [method, handler] of Object.entries(routeModule)) {
    if (typeof handler === "function" && ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      instrumented[method] = instrumentRoute(
        routeTemplate,
        handler as (req: Request) => Promise<Response>,
        neonClientOrFactory
      );
    }
  }

  return instrumented;
}
