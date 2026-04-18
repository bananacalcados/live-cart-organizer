DROP FUNCTION IF EXISTS public.try_claim_scheduled_message(uuid, integer);

CREATE OR REPLACE FUNCTION public.try_claim_scheduled_message(
  p_message_id UUID,
  p_lock_duration_seconds INTEGER DEFAULT 90
)
RETURNS TABLE (
  claimed_id UUID,
  message_group_id UUID,
  was_recovery BOOLEAN
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_until TIMESTAMPTZ := v_now + (p_lock_duration_seconds || ' seconds')::INTERVAL;
  v_prev_status TEXT;
BEGIN
  SELECT status INTO v_prev_status
  FROM group_campaign_scheduled_messages
  WHERE id = p_message_id;

  RETURN QUERY
  UPDATE group_campaign_scheduled_messages
  SET 
    status = 'sending',
    locked_until = v_lock_until,
    last_execution_at = v_now,
    execution_count = execution_count + 1
  WHERE id = p_message_id
    AND (
      status = 'pending'
      OR (status = 'sending' AND (locked_until IS NULL OR locked_until < v_now))
    )
  RETURNING 
    group_campaign_scheduled_messages.id,
    group_campaign_scheduled_messages.message_group_id,
    (v_prev_status = 'sending');
END;
$$;