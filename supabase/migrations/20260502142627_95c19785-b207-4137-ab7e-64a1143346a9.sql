CREATE TABLE public.inventory_audit_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  per_store JSONB DEFAULT '[]'::jsonb,
  totals JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read audit runs"
  ON public.inventory_audit_runs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role manages audit runs"
  ON public.inventory_audit_runs FOR ALL
  TO service_role USING (true) WITH CHECK (true);