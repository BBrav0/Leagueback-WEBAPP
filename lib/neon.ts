import "server-only";

import { neon } from "@neondatabase/serverless";

/**
 * Server-only Neon client for API routes and lib modules used only on the server.
 *
 * **Connection:** Uses `neon()` HTTP mode from `@neondatabase/serverless`.
 * All queries are sent as parameterized SQL over HTTPS — no persistent
 * connections, no WebSocket overhead.
 *
 * **server-only guard:** Importing this module from a client bundle fails at
 * build time. This prevents accidentally exposing the database connection
 * string to the browser.
 *
 * **Lazy singleton:** `process.env.DATABASE_URL` is read at call-time so this
 * module works on platforms where env vars are only available inside a request
 * context (e.g. Cloudflare Workers).
 */

/**
 * Returns a lazy SQL function for executing parameterized queries against Neon.
 * The connection is created on first call and reused thereafter.
 *
 * @example
 * ```ts
 * import { getSql } from "@/lib/neon";
 * const sql = getSql();
 * const rows = await sql`SELECT * FROM accounts WHERE puuid = ${puuid}`;
 * ```
 *
 * @throws {Error} If DATABASE_URL is not set in the environment.
 */
export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "Missing DATABASE_URL environment variable. Set it in .env.local or your deployment environment."
    );
  }

  // Create a new function each call — neon() itself is lightweight and
  // the HTTP transport has no persistent state to cache. This keeps the
  // module simple and compatible with edge runtimes where env vars may
  // vary per request.
  return neon(databaseUrl);
}

/**
 * Returns a full-results SQL function for queries that need metadata
 * like `rowCount`, `command`, or `fields`.
 *
 * @example
 * ```ts
 * import { getSqlFull } from "@/lib/neon";
 * const sqlFull = getSqlFull();
 * const result = await sqlFull`UPDATE posts SET title = ${title} WHERE id = ${id}`;
 * console.log(result.rowCount); // number of rows affected
 * ```
 */
export function getSqlFull() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "Missing DATABASE_URL environment variable. Set it in .env.local or your deployment environment."
    );
  }

  return neon(databaseUrl, { fullResults: true });
}
