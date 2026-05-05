
CREATE TABLE IF NOT EXISTS public.automation_dispatch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  total_audience INTEGER NOT NULL DEFAULT 0,
  current_offset INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 2000,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_dispatch_jobs_flow ON public.automation_dispatch_jobs(flow_id);
CREATE INDEX IF NOT EXISTS idx_auto_dispatch_jobs_status ON public.automation_dispatch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_auto_dispatch_jobs_heartbeat ON public.automation_dispatch_jobs(heartbeat_at) WHERE status = 'running';

ALTER TABLE public.automation_dispatch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view jobs"
  ON public.automation_dispatch_jobs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert jobs"
  ON public.automation_dispatch_jobs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update jobs"
  ON public.automation_dispatch_jobs FOR UPDATE
  TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_dispatch_jobs;
