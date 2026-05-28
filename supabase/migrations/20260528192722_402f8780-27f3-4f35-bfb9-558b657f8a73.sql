
ALTER TABLE public.dispatch_recipients
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_dispatch_recipients_claim
  ON public.dispatch_recipients (dispatch_id, status, lease_until);

CREATE INDEX IF NOT EXISTS idx_dispatch_recipients_status_lease
  ON public.dispatch_recipients (status, lease_until)
  WHERE status = 'leased';

-- Function: atomically claim a batch of jobs for a dispatch
CREATE OR REPLACE FUNCTION public.claim_dispatch_jobs(
  p_dispatch_id uuid,
  p_worker_id text,
  p_batch_size int DEFAULT 20,
  p_lease_seconds int DEFAULT 60
)
RETURNS TABLE (id uuid, phone text, recipient_name text, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT r.id
    FROM public.dispatch_recipients r
    WHERE r.dispatch_id = p_dispatch_id
      AND (
        r.status = 'pending'
        OR (r.status = 'leased' AND r.lease_until IS NOT NULL AND r.lease_until < now())
      )
      AND r.attempts < 3
    ORDER BY r.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.dispatch_recipients r
  SET status = 'leased',
      lease_until = now() + make_interval(secs => p_lease_seconds),
      worker_id = p_worker_id,
      attempts = r.attempts + 1
  FROM claimed c
  WHERE r.id = c.id
  RETURNING r.id, r.phone, r.recipient_name, r.attempts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_dispatch_jobs(uuid, text, int, int) TO service_role;

-- Function: return dispatches that still have pending or expired-leased work
CREATE OR REPLACE FUNCTION public.get_dispatches_with_pending(p_limit int DEFAULT 20)
RETURNS TABLE (dispatch_id uuid, pending_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, COUNT(r.id)::bigint AS pending_count
  FROM public.dispatch_history d
  JOIN public.dispatch_recipients r ON r.dispatch_id = d.id
  WHERE d.status = 'sending'
    AND (
      r.status = 'pending'
      OR (r.status = 'leased' AND r.lease_until IS NOT NULL AND r.lease_until < now())
    )
    AND r.attempts < 3
  GROUP BY d.id
  ORDER BY MIN(r.created_at) ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_dispatches_with_pending(int) TO service_role;

-- Function: return dispatches that are completely done so we can mark them finished
CREATE OR REPLACE FUNCTION public.finalize_completed_dispatches()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH done AS (
    SELECT d.id
    FROM public.dispatch_history d
    WHERE d.status = 'sending'
      AND NOT EXISTS (
        SELECT 1 FROM public.dispatch_recipients r
        WHERE r.dispatch_id = d.id
          AND (
            r.status = 'pending'
            OR (r.status = 'leased' AND (r.lease_until IS NULL OR r.lease_until > now()))
          )
          AND r.attempts < 3
      )
  ),
  agg AS (
    SELECT d.id,
      COUNT(*) FILTER (WHERE r.status IN ('sent','delivered','read'))::int AS sent_count,
      COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed_count
    FROM done d
    JOIN public.dispatch_recipients r ON r.dispatch_id = d.id
    GROUP BY d.id
  )
  UPDATE public.dispatch_history h
  SET status = 'completed',
      completed_at = now(),
      processing_batch = false,
      sent_count = a.sent_count,
      failed_count = a.failed_count
  FROM agg a
  WHERE h.id = a.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_completed_dispatches() TO service_role;
