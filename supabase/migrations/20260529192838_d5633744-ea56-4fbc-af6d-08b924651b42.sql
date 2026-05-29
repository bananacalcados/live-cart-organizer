CREATE OR REPLACE FUNCTION public.try_claim_scheduled_message(p_message_id uuid, p_lock_duration_seconds integer DEFAULT 90)
 RETURNS TABLE(claimed_id uuid, message_group_id uuid, was_recovery boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_until TIMESTAMPTZ := v_now + (p_lock_duration_seconds || ' seconds')::INTERVAL;
  v_group UUID;
  v_anchor UUID;
  v_prev_status TEXT;
  v_claimed BOOLEAN := FALSE;
BEGIN
  SELECT m.message_group_id INTO v_group
  FROM group_campaign_scheduled_messages m
  WHERE m.id = p_message_id;

  IF v_group IS NULL THEN
    SELECT m.status INTO v_prev_status
    FROM group_campaign_scheduled_messages m
    WHERE m.id = p_message_id;

    RETURN QUERY
    UPDATE group_campaign_scheduled_messages m
    SET
      status = 'sending',
      locked_until = v_lock_until,
      last_execution_at = v_now,
      execution_count = m.execution_count + 1
    WHERE m.id = p_message_id
      AND (
        m.status = 'pending'
        OR (m.status = 'sending' AND (m.locked_until IS NULL OR m.locked_until < v_now))
      )
    RETURNING
      m.id,
      m.message_group_id,
      (v_prev_status = 'sending');
    RETURN;
  END IF;

  SELECT m.id INTO v_anchor
  FROM group_campaign_scheduled_messages m
  WHERE m.message_group_id = v_group
  ORDER BY m.block_order ASC NULLS LAST, m.scheduled_at ASC
  LIMIT 1;

  SELECT m.status INTO v_prev_status
  FROM group_campaign_scheduled_messages m
  WHERE m.id = v_anchor;

  UPDATE group_campaign_scheduled_messages m
  SET
    status = 'sending',
    locked_until = v_lock_until,
    last_execution_at = v_now,
    execution_count = m.execution_count + 1
  WHERE m.id = v_anchor
    AND (
      m.status IN ('pending', 'grouped')
      OR (m.status = 'sending' AND (m.locked_until IS NULL OR m.locked_until < v_now))
    );

  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF v_claimed THEN
    UPDATE group_campaign_scheduled_messages m
    SET status = 'sending', locked_until = v_lock_until
    WHERE m.message_group_id = v_group
      AND m.id <> v_anchor;

    RETURN QUERY
    SELECT v_anchor, v_group, (v_prev_status = 'sending');
  END IF;

  RETURN;
END;
$function$;