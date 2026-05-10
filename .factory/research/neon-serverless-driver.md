# @neondatabase/serverless — Driver Reference

> Version: 1.1.0 (latest as of April 2026)  
> License: MIT | 0 runtime dependencies | Drop-in replacement for `pg` (node-postgres)

---

## Installation

```bash
npm install @neondatabase/serverless
```

TypeScript types are included — no `@types/pg` needed.

---

## Connection String Format

```
postgresql://user:password@<NEON_HOST>/neondb?sslmode=require
```

Environment variable: `DATABASE_URL`

---

## Two Connection Modes

| Mode | Import | Transport | Use Case |
|------|--------|-----------|----------|
| **HTTP** (`neon()`) | `import { neon }` | HTTPS fetch | One-shot queries, lowest latency |
| **WebSocket** (`Pool`/`Client`) | `import { Pool }` | WebSocket | Sessions, interactive transactions, node-postgres compat |

**For Leagueback API routes, use `neon()` (HTTP mode).** It's faster for single queries and non-interactive transactions.

---

## HTTP Mode — `neon()` Function

### Setup

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
```

### Template Tag Queries (Recommended — SQL Injection Safe)

```typescript
// SELECT
const rows = await sql`SELECT * FROM posts WHERE id = ${postId}`;
// rows = [{ id: 12, title: 'My post', ... }]  (array of objects)
// If no rows: []

// Destructure single row
const [post] = await sql`SELECT * FROM posts WHERE id = ${postId}`;
// post = { id: 12, title: 'My post', ... } or undefined

// INSERT
await sql`INSERT INTO posts (title, body) VALUES (${title}, ${body})`;

// INSERT ... RETURNING
const [newPost] = await sql`
  INSERT INTO posts (title, body) 
  VALUES (${title}, ${body}) 
  RETURNING *
`;

// UPDATE
await sql`UPDATE posts SET title = ${newTitle} WHERE id = ${postId}`;

// DELETE
await sql`DELETE FROM posts WHERE id = ${postId}`;
```

### Parameterized Queries via `.query()`

Use `sql.query()` when you need explicit `$1`, `$2` placeholders (e.g., for dynamic SQL or compatibility):

```typescript
const rows = await sql.query(
  'SELECT * FROM posts WHERE id = $1',
  [postId]
);
// rows = [{ id: 12, title: 'My post', ... }]
```

### Composable Template Fragments

Template queries are fully composable:

```typescript
const name = 'Olivia';
const limit = 10;
const whereClause = sql`WHERE name = ${name}`;
const limitClause = sql`LIMIT ${limit}`;

const rows = await sql`SELECT * FROM users ${whereClause} ${limitClause}`;
// Parameters are auto-numbered correctly at query time
```

### Unsafe String Interpolation (for trusted column/table names only)

```typescript
const tableName = 'posts';  // must be a known-safe value
const rows = await sql`SELECT * FROM ${sql.unsafe(tableName)} WHERE id = ${id}`;
```

---

## Return Values

### Default: Array of Objects

```typescript
const rows = await sql`SELECT * FROM posts`;
// -> [{ id: 1, title: 'Hello', ... }, { id: 2, title: 'World', ... }]
// Empty result: []
```

### Full Results (with metadata)

```typescript
const sql = neon(process.env.DATABASE_URL!, { fullResults: true });

const result = await sql`SELECT * FROM posts WHERE id = ${postId}`;
// result = {
//   rows: [{ id: 12, title: 'My post', ... }],
//   fields: [{ name: 'id', dataTypeID: 23, ... }, ...],
//   rowCount: 1,
//   rowAsArray: false,
//   command: 'SELECT'    // or 'INSERT', 'UPDATE', 'DELETE'
// }
```

Or per-query with `.query()`:

```typescript
const result = await sql.query(
  'UPDATE posts SET title = $1 WHERE id = $2',
  [newTitle, postId],
  { fullResults: true }
);
// result.rowCount = number of affected rows
// result.command = 'UPDATE'
```

### Getting Row Count for INSERT/UPDATE/DELETE

You **must** use `fullResults: true` to get `rowCount`:

```typescript
const sql = neon(process.env.DATABASE_URL!, { fullResults: true });
const result = await sql`UPDATE posts SET archived = true WHERE created_at < ${cutoff}`;
console.log(result.rowCount); // number of rows affected
```

---

## Common Query Patterns

### ILIKE (Case-Insensitive Search)

```typescript
const searchTerm = `%${query}%`;
const rows = await sql`
  SELECT * FROM accounts 
  WHERE game_name ILIKE ${searchTerm}
`;
```

### IN Clause with Arrays — Use `= ANY()`

**PostgreSQL's `ANY()` operator works with array parameters.** This is the standard way to do `IN` with parameterized queries:

```typescript
// Template tag — pass array directly
const matchIds = ['NA1_123', 'NA1_456', 'NA1_789'];
const rows = await sql`
  SELECT * FROM match_cache 
  WHERE match_id = ANY(${matchIds})
`;

// With .query() — same pattern
const rows = await sql.query(
  'SELECT * FROM match_cache WHERE match_id = ANY($1)',
  [matchIds]
);
```

**NOT IN equivalent:**

```typescript
const rows = await sql`
  SELECT * FROM match_cache 
  WHERE match_id != ALL(${excludeIds})
`;
```

### ON CONFLICT Upsert

```typescript
// Simple upsert
const [row] = await sql`
  INSERT INTO accounts (puuid, game_name, tag_line, updated_at)
  VALUES (${puuid}, ${gameName}, ${tagLine}, NOW())
  ON CONFLICT (puuid) 
  DO UPDATE SET 
    game_name = EXCLUDED.game_name,
    tag_line = EXCLUDED.tag_line,
    updated_at = NOW()
  RETURNING *
`;

// Upsert with no update (insert-or-ignore)
await sql`
  INSERT INTO match_cache (match_id, match_data, timeline_data)
  VALUES (${matchId}, ${matchJson}, ${timelineJson})
  ON CONFLICT (match_id) DO NOTHING
`;
```

### JSONB Handling

Pass JavaScript objects — they are serialized automatically by the driver when the column type is `jsonb`:

```typescript
// INSERT with JSONB — pass JS object, cast to jsonb
const matchData = { participants: [...], teams: [...] };
await sql`
  INSERT INTO match_cache (match_id, match_data)
  VALUES (${matchId}, ${JSON.stringify(matchData)}::jsonb)
`;

// Or with .query():
await sql.query(
  'INSERT INTO match_cache (match_id, match_data) VALUES ($1, $2::jsonb)',
  [matchId, JSON.stringify(matchData)]
);

// SELECT JSONB — returned as parsed JS objects automatically
const [row] = await sql`SELECT match_data FROM match_cache WHERE match_id = ${matchId}`;
// row.match_data is already a JS object (auto-parsed)

// Query inside JSONB
const rows = await sql`
  SELECT * FROM match_cache 
  WHERE match_data->>'gameMode' = ${gameMode}
`;
```

### Pagination with LIMIT/OFFSET

```typescript
const rows = await sql`
  SELECT * FROM player_matches 
  WHERE puuid = ${puuid}
  ORDER BY match_id DESC
  LIMIT ${limit} OFFSET ${offset}
`;
```

### COUNT Queries

```typescript
const [{ count }] = await sql`
  SELECT COUNT(*)::int AS count 
  FROM player_matches 
  WHERE puuid = ${puuid}
`;
// count is a number (the ::int cast avoids getting a string for bigint)
```

---

## Non-Interactive Transactions (HTTP mode)

Use `sql.transaction()` to run multiple queries in a single HTTP request as a transaction:

```typescript
const [posts, tags] = await sql.transaction([
  sql`SELECT * FROM posts ORDER BY created_at DESC LIMIT ${limit}`,
  sql`SELECT * FROM tags`,
]);
// posts and tags are both arrays of row objects
```

With options:

```typescript
const [posts, tags] = await sql.transaction(
  [
    sql`SELECT * FROM posts ORDER BY created_at DESC LIMIT ${limit}`,
    sql`SELECT * FROM tags`,
  ],
  {
    isolationLevel: 'RepeatableRead',
    readOnly: true,
  }
);
```

Function form (useful for dynamic query lists):

```typescript
const results = await sql.transaction((txn) => [
  txn`INSERT INTO posts (title) VALUES (${title}) RETURNING id`,
  txn`INSERT INTO audit_log (action) VALUES ('post_created')`,
]);
```

**Important:** `sql.transaction()` is non-interactive — you cannot use the result of one query in a subsequent query within the same transaction. For interactive transactions, use `Pool`/`Client` with WebSockets.

---

## Interactive Transactions (WebSocket mode — Pool/Client)

Only needed when one query depends on the result of a previous query within the same transaction:

```typescript
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  
  const { rows: [{ id: postId }] } = await client.query(
    'INSERT INTO posts (title) VALUES ($1) RETURNING id',
    ['Welcome']
  );
  
  await client.query(
    'INSERT INTO photos (post_id, url) VALUES ($1, $2)',
    [postId, 's3.bucket/photo/url']
  );
  
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}

await pool.end();
```

**Note for serverless/edge (Cloudflare Workers, Vercel Edge):** Pool/Client must be created and closed within a single request handler. Don't reuse across requests.

---

## Error Handling

The driver throws standard JavaScript errors. Wrap in try/catch:

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

try {
  const rows = await sql`SELECT * FROM posts WHERE id = ${postId}`;
  return rows;
} catch (error) {
  // Error properties (from node-postgres / neon driver):
  // error.message    — human-readable error message
  // error.code       — PostgreSQL error code (e.g., '23505' for unique violation)
  // error.detail     — detailed error info from Postgres
  // error.constraint — constraint name (for constraint violations)
  // error.table      — table name involved
  // error.column     — column name involved
  
  if (error instanceof Error) {
    const pgError = error as any;
    
    if (pgError.code === '23505') {
      // Unique constraint violation
      console.error('Duplicate key:', pgError.detail);
    } else if (pgError.code === '23503') {
      // Foreign key constraint violation
      console.error('Referenced row not found:', pgError.detail);
    } else {
      console.error('Database error:', error.message);
    }
  }
  
  throw error;
}
```

### Common PostgreSQL Error Codes

| Code | Name | Meaning |
|------|------|---------|
| `23505` | `unique_violation` | Duplicate key violates unique constraint |
| `23503` | `foreign_key_violation` | Referenced row does not exist |
| `23502` | `not_null_violation` | NULL in a NOT NULL column |
| `42P01` | `undefined_table` | Table does not exist |
| `42703` | `undefined_column` | Column does not exist |
| `57014` | `query_canceled` | Query cancelled (timeout) |

### Retry Pattern for Transient Errors

```typescript
import { neon } from '@neondatabase/serverless';

async function queryWithRetry<T>(
  queryFn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

// Usage:
const sql = neon(process.env.DATABASE_URL!);
const rows = await queryWithRetry(() => 
  sql`SELECT * FROM posts WHERE id = ${postId}`
);
```

---

## Standard Import Pattern for Leagueback Workers

```typescript
import { neon } from '@neondatabase/serverless';

// Create the SQL function once per module (or per request in serverless)
const sql = neon(process.env.DATABASE_URL!);

// For routes that need row count metadata:
const sqlFull = neon(process.env.DATABASE_URL!, { fullResults: true });
```

### Complete API Route Example (Next.js App Router)

```typescript
import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');

  if (!puuid) {
    return NextResponse.json(
      { success: false, error: 'Missing puuid parameter' },
      { status: 400 }
    );
  }

  try {
    const matches = await sql`
      SELECT * FROM player_matches 
      WHERE puuid = ${puuid}
      ORDER BY match_id DESC
      LIMIT 20
    `;

    return NextResponse.json({ success: true, data: matches });
  } catch (error) {
    console.error('Database query failed:', error);
    return NextResponse.json(
      { success: false, error: 'Database query failed' },
      { status: 500 }
    );
  }
}
```

---

## Key Differences from Supabase Client

| Feature | Supabase (`@supabase/supabase-js`) | Neon (`@neondatabase/serverless`) |
|---------|-----------------------------------|----------------------------------|
| Query style | `.from('table').select().eq()` builder | Raw SQL (template tags or parameterized) |
| RLS | Enforced by default | Not applicable (direct DB connection) |
| Auth integration | Built-in JWT + RLS | Manual (use service role connection) |
| JSONB | Auto-handled | Must `JSON.stringify()` + `::jsonb` cast on insert |
| Arrays for IN | `.in('col', [...])` | `WHERE col = ANY(${arr})` |
| ILIKE | `.ilike('col', '%val%')` | `WHERE col ILIKE ${pattern}` |
| Upsert | `.upsert({...})` | `INSERT ... ON CONFLICT ... DO UPDATE` |
| Result shape | `{ data, error }` | Array of rows (or throws on error) |
| Row count | `{ count }` option | `fullResults: true` → `result.rowCount` |

---

## Limits

- Maximum HTTP request/response size: **64 MB**
- Requires Node.js **≥ 19** (for v1.0.0+)
- WebSocket mode in serverless environments: connections must be opened and closed within a single request
