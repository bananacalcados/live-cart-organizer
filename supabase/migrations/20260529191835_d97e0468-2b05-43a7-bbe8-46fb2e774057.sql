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
  -- Descobre se a mensagem faz parte de um grupo de blocos
  SELECT m.message_group_id INTO v_group
  FROM group_campaign_scheduled_messages m
  WHERE m.id = p_message_id;

  IF v_group IS NULL THEN
    -- Mensagem avulsa: comportamento original (trava a própria linha)
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
    RETURN;
  END IF;

  -- Mensagem agrupada: a trava é decidida por um único bloco "âncora"
  -- (o de menor block_order). Assim, dois disparos concorrentes que assumam
  -- linhas diferentes do MESMO grupo competem pela mesma âncora e só um vence.
  SELECT id INTO v_anchor
  FROM group_campaign_scheduled_messages
  WHERE message_group_id = v_group
  ORDER BY block_order ASC NULLS LAST, scheduled_at ASC
  LIMIT 1;

  SELECT status INTO v_prev_status
  FROM group_campaign_scheduled_messages
  WHERE id = v_anchor;

  -- Tenta travar a âncora de forma atômica
  UPDATE group_campaign_scheduled_messages
  SET
    status = 'sending',
    locked_until = v_lock_until,
    last_execution_at = v_now,
    execution_count = execution_count + 1
  WHERE id = v_anchor
    AND (
      status IN ('pending', 'grouped')
      OR (status = 'sending' AND (locked_until IS NULL OR locked_until < v_now))
    );

  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF v_claimed THEN
    -- Trava também os demais blocos do grupo (sob a mesma trava)
    UPDATE group_campaign_scheduled_messages
    SET status = 'sending', locked_until = v_lock_until
    WHERE message_group_id = v_group
      AND id <> v_anchor;

    RETURN QUERY
    SELECT v_anchor, v_group, (v_prev_status = 'sending');
  END IF;

  -- Se não travou (já está em andamento por outro processo), retorna vazio
  RETURN;
END;
$function$;