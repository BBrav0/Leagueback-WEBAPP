-- Enable RLS and add permissive policies for all tables

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_categories ENABLE ROW LEVEL SECURITY;

-- accounts
CREATE POLICY "Allow anon select" ON public.accounts FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON public.accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.accounts FOR UPDATE USING (true);

-- match_details
CREATE POLICY "Allow anon select" ON public.match_details FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON public.match_details FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.match_details FOR UPDATE USING (true);

-- match_timelines
CREATE POLICY "Allow anon select" ON public.match_timelines FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON public.match_timelines FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.match_timelines FOR UPDATE USING (true);

-- impact_categories
CREATE POLICY "Allow anon select" ON public.impact_categories FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON public.impact_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.impact_categories FOR UPDATE USING (true);
