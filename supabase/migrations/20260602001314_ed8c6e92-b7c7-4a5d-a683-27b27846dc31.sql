-- VIP group dispatch: durable queue with send_after (no in-memory sleeps)
ALTER TABLE public.group_campaign_block_dispatches
  ADD COLUMN IF NOT EXISTS send_after timestamptz,
  ADD COLUMN IF NOT EXISTS delay_after_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seq integer,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Queue lookup index (per instance, ready jobs)
CREATE INDEX IF NOT EXISTS idx_block_disp_queue
  ON public.group_campaign_block_dispatches (whatsapp_number_id, status, send_after);

-- Idempotent planning: dedupe queued jobs (only rows that belong to the new queue, i.e. seq IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_block_job_queued
  ON public.group_campaign_block_dispatches (scheduled_message_id, group_db_id, block_order)
  WHERE seq IS NOT NULL;

-- Claim the next READY job for a given instance, strictly serialized per dispatch.
-- Picks the OLDEST dispatch (message_group or single message) for that instance that
-- still has pending jobs, then returns its lowest-seq pending job ONLY IF it is ready
-- (send_after <= now and not locked). Otherwise returns nothing (we are waiting on the gap).
CREATE OR REPLACE FUNCTION public.claim_group_dispatch_job(p_number_id uuid)
RETURNS SETOF public.group_campaign_block_dispatches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_job_id uuid;
  v_ready boolean;
BEGIN
  -- Oldest dispatch for this instance with remaining pending jobs
  SELECT COALESCE(message_group_id::text, scheduled_message_id::text)
    INTO v_key
  FROM public.group_campaign_block_dispatches
  WHERE whatsapp_number_id = p_number_id
    AND status = 'pending'
    AND seq IS NOT NULL
  GROUP BY COALESCE(message_group_id::text, scheduled_message_id::text)
  ORDER BY MIN(created_at) ASC
  LIMIT 1;

  IF v_key IS NULL THEN
    RETURN;
  END IF;

  -- Lowest-seq pending job of that dispatch, locked for this txn
  SELECT id
    INTO v_job_id
  FROM public.group_campaign_block_dispatches
  WHERE COALESCE(message_group_id::text, scheduled_message_id::text) = v_key
    AND status = 'pending'
    AND seq IS NOT NULL
  ORDER BY seq ASC, block_order ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Is it ready?
  SELECT (send_after IS NOT NULL AND send_after <= now()
          AND (locked_until IS NULL OR locked_until < now()))
    INTO v_ready
  FROM public.group_campaign_block_dispatches
  WHERE id = v_job_id;

  IF NOT v_ready THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.group_campaign_block_dispatches
     SET locked_until = now() + interval '120 seconds'
   WHERE id = v_job_id
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_group_dispatch_job(uuid) TO service_role;

-- Distinct instances that currently have READY pending jobs (for the orchestrator cron)
CREATE OR REPLACE FUNCTION public.get_group_dispatch_ready_instances()
RETURNS TABLE (whatsapp_number_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT j.whatsapp_number_id
  FROM public.group_campaign_block_dispatches j
  WHERE j.status = 'pending'
    AND j.seq IS NOT NULL
    AND j.send_after IS NOT NULL
    AND j.send_after <= now()
    AND (j.locked_until IS NULL OR j.locked_until < now())
    AND j.whatsapp_number_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_dispatch_ready_instances() TO service_role;