CREATE TABLE IF NOT EXISTS public.automation_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  flow_id uuid,
  step_id uuid,
  step_index integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_number_id uuid,
  recipient_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_by text,
  locked_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.automation_message_queue TO authenticated;
GRANT ALL ON public.automation_message_queue TO service_role;

ALTER TABLE public.automation_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view automation queue"
ON public.automation_message_queue FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_queue_dedupe
ON public.automation_message_queue (phone, flow_id, step_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_automation_queue_due
ON public.automation_message_queue (status, scheduled_at)
WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_automation_queue_phone
ON public.automation_message_queue (phone, created_at DESC);

CREATE TRIGGER trg_automation_message_queue_updated_at
BEFORE UPDATE ON public.automation_message_queue
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_automation_queue_jobs(
  p_worker_id text,
  p_batch_size integer DEFAULT 30,
  p_lease_seconds integer DEFAULT 120,
  p_max_attempts integer DEFAULT 3
)
RETURNS SETOF public.automation_message_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT q.id
    FROM public.automation_message_queue q
    WHERE q.scheduled_at <= now()
      AND q.attempts < p_max_attempts
      AND (
        q.status = 'pending'
        OR (q.status = 'sending' AND (q.locked_until IS NULL OR q.locked_until < now()))
      )
    ORDER BY q.scheduled_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.automation_message_queue q
  SET status = 'sending',
      locked_by = p_worker_id,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      attempts = q.attempts + 1,
      updated_at = now()
  FROM due
  WHERE q.id = due.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_queue_jobs(text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_automation_queue_jobs(text, integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.automation_queue_pending_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.automation_message_queue
  WHERE status IN ('pending', 'sending');
$$;

GRANT EXECUTE ON FUNCTION public.automation_queue_pending_count() TO authenticated, service_role;