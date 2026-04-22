# Architecture

Architectural decisions and patterns for the Supabase-to-Neon migration.

---

## Migration Strategy

**Before:** All database access via `@supabase/supabase-js` PostgREST client → Supabase REST API → PostgreSQL  
**After:** All database access via `@neondatabase/serverless` HTTP driver → Neon PostgreSQL directly

## Client Pattern

Single server-side module: `lib/neon.ts`
- Imports `neon` from `@neondatabase/serverless`
- Reads `DATABASE_URL` from environment
- Uses `import "server-only"` to prevent client-side import
- Exports a lazy `sql` function for queries
- All queries use SQL template tags with parameterized values

## Query Migration Patterns

| Supabase Pattern | Neon Equivalent |
|-----------------|-----------------|
| `.from("table").select("*").eq("col", val)` | `` sql`SELECT * FROM table WHERE col = ${val}` `` |
| `.from("table").select("*").in("col", arr)` | `` sql`SELECT * FROM table WHERE col = ANY(${arr})` `` |
| `.from("table").select("*").ilike("col", val)` | `` sql`SELECT * FROM table WHERE col ILIKE ${val}` `` |
| `.from("table").upsert({...})` | `` sql`INSERT INTO table (...) VALUES (...) ON CONFLICT (...) DO UPDATE SET ...` `` |
| `.select("*", { count: "exact" })` | Separate `COUNT(*)` query or window function |
| `.range(offset, offset+limit-1)` | `LIMIT ${limit} OFFSET ${offset}` |
| `.order("col", { ascending: false })` | `ORDER BY col DESC` |
| `.maybeSingle()` | Check `rows[0]`, return null if undefined |
| `.single()` | Check `rows[0]`, handle missing as needed |
| `{ data, error }` destructuring | `try/catch` blocks |

## Error Handling Change

**Before (Supabase):**
```typescript
const { data, error } = await supabase.from("table").select();
if (error) { console.error(error); return fallback; }
return data;
```

**After (Neon):**
```typescript
try {
  const rows = await sql`SELECT * FROM table`;
  return rows;
} catch (error) {
  console.error("Query failed:", error);
  return fallback;
}
```

## JSONB Handling

- **Insert:** `JSON.stringify(obj)` with `::jsonb` cast
- **Select:** Auto-parsed by driver — returned as JS objects
- All existing JSONB columns: `match_data`, `timeline_data`, `chart_data`, `notes`

## No RLS in Neon

Supabase used Row Level Security (anon SELECT policies + service role bypass). Neon has no RLS equivalent in this setup — the single `neondb_owner` role has full access. This is fine because:
1. All API routes are server-side (no client-side DB access)
2. The app has no user authentication
3. All data is public League of Legends match data
