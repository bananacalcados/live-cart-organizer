CREATE TABLE IF NOT EXISTS public.inventory_incremental_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running',
  days_window INTEGER NOT NULL DEFAULT 1,
  since_date TEXT,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  per_store JSONB NOT NULL DEFAULT '[]'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_incremental_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read incremental runs"
  ON public.inventory_incremental_runs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role manages incremental runs"
  ON public.inventory_incremental_runs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_inventory_incremental_runs_created
  ON public.inventory_incremental_runs(created_at DESC);