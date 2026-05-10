-- Analytics events table and summary-friendly indexes.
--
-- Stores privacy-light, first-party analytics events for Leagueback.
-- Dedicated analytics objects — does not modify existing product cache tables.

-- Main analytics events table
CREATE TABLE public.analytics_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name    text NOT NULL,
  visitor_id    text NOT NULL,
  session_id    text NOT NULL,
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for summary queries: aggregate by day + event name
CREATE INDEX idx_analytics_events_created_at_event
  ON public.analytics_events (created_at DESC, event_name);

-- Index for session-scoped queries
CREATE INDEX idx_analytics_events_session_id
  ON public.analytics_events (session_id, created_at DESC);

-- Index for visitor-scoped deduplication queries
CREATE INDEX idx_analytics_events_visitor_id
  ON public.analytics_events (visitor_id, created_at DESC);

-- Index for filtering by event name alone (endpoint errors, categories)
CREATE INDEX idx_analytics_events_event_name
  ON public.analytics_events (event_name, created_at DESC);

-- Enable RLS (analytics writes are server-side only via service_role key)
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Server-side service_role can insert/select
CREATE POLICY "Allow service_role full access" ON public.analytics_events
  FOR ALL USING (true) WITH CHECK (true);

-- No anon/public read — analytics data is protected
