-- Analytics events table and summary-friendly indexes.
--
-- Stores privacy-light, first-party analytics events for Leagueback.
-- Dedicated analytics objects — does not modify existing product cache tables.
--
-- Neon/PostgreSQL-compatible: the table owner role bypasses RLS by default,
-- so server-side writes via the Neon connection role are unaffected.
-- RLS blocks any non-owner direct access.

-- Main analytics events table
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name    text NOT NULL,
  visitor_id    text NOT NULL,
  session_id    text NOT NULL,
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for summary queries: aggregate by day + event name
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at_event
  ON public.analytics_events (created_at DESC, event_name);

-- Index for session-scoped queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id
  ON public.analytics_events (session_id, created_at DESC);

-- Index for visitor-scoped deduplication queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor_id
  ON public.analytics_events (visitor_id, created_at DESC);

-- Index for filtering by event name alone (endpoint errors, categories)
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name
  ON public.analytics_events (event_name, created_at DESC);

-- Enable RLS (analytics writes are server-side only via the Neon connection role)
-- The table owner bypasses RLS, so server-side code using the connection role
-- can read and write freely. RLS blocks non-owner roles from accessing data.
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Default restrictive policy: block all non-owner access.
-- The table owner (Neon connection role) bypasses RLS automatically.
-- No additional GRANT is needed — ownership provides full access.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'analytics_events'
      AND policyname = 'Owner bypass only'
  ) THEN
    CREATE POLICY "Owner bypass only" ON public.analytics_events
      AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
  END IF;
END
$$;
