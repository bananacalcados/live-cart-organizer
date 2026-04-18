CREATE OR REPLACE FUNCTION public.try_claim_scheduled_message(
  p_message_id UUID,
  p_lock_duration_seconds INTEGER DEFAULT 90
)
RETURNS TABLE (
  claimed_id UUID,
  message_group_id UUID,
  previous_status TEXT,
  previous_locked_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_until TIMESTAMPTZ := v_now + (p_lock_duration_seconds || ' seconds')::INTERVAL;
BEGIN
  RETURN QUERY
  UPDATE group_campaign_scheduled_messages
  SET 
    status = 'sending',
    locked_until = v_lock_until,
    last_execution_at = v_now,
    execution_count = execution_count + 1
  WHERE id = p_message_id
    AND status = 'pending'
    AND (locked_until IS NULL OR locked_until < v_now)
  RETURNING 
    group_campaign_scheduled_messages.id,
    group_campaign_scheduled_messages.message_group_id,
    'pending'::TEXT,
    NULL::TIMESTAMPTZ;
END;
$$;

COMMENT ON FUNCTION public.try_claim_scheduled_message IS 
  'Claim atômico de mensagem agendada. Retorna linha apenas se conseguiu travar (status=pending E locked_until nulo/expirado). Garante atomicidade via UPDATE SQL puro, evitando problemas do PostgREST com timestamps em .or().';

CREATE OR REPLACE FUNCTION public.get_dispatchable_scheduled_messages(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  scheduled_at TIMESTAMPTZ,
  campaign_id UUID,
  status TEXT,
  message_group_id UUID,
  block_order INTEGER,
  locked_until TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 
    m.id,
    m.scheduled_at,
    m.campaign_id,
    m.status,
    m.message_group_id,
    m.block_order,
    m.locked_until
  FROM group_campaign_scheduled_messages m
  WHERE m.status != 'grouped'
    AND (
      (m.status = 'pending' AND m.scheduled_at <= NOW())
      OR
      (m.status = 'sending' AND (m.locked_until IS NULL OR m.locked_until < NOW()))
    )
  ORDER BY m.block_order ASC NULLS LAST, m.scheduled_at ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_dispatchable_scheduled_messages IS 
  'Retorna mensagens prontas para dispatch pelo cron. Filtra pending vencidas + sending com lock expirado, tudo em SQL nativo para evitar problemas do PostgREST.';