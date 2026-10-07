ALTER TABLE public.automation_dispatch_jobs ADD COLUMN IF NOT EXISTS audience_cached_at timestamptz;

CREATE TABLE IF NOT EXISTS public.automation_dispatch_job_audience (
  job_id uuid NOT NULL,
  pos integer NOT NULL,
  phone text NOT NULL,
  recipient jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  PRIMARY KEY (job_id, pos)
);
GRANT ALL ON public.automation_dispatch_job_audience TO service_role;
ALTER TABLE public.automation_dispatch_job_audience ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_adja_pending ON public.automation_dispatch_job_audience (job_id, pos) WHERE status = 'pending';