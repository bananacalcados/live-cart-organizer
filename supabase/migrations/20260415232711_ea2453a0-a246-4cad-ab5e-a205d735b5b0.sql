
CREATE OR REPLACE FUNCTION public.get_reactivation_candidates(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_45_days_ago timestamptz := v_now - interval '45 days';
  v_730_days_ago timestamptz := v_now - interval '730 days';
  v_30_days_ago timestamptz := v_now - interval '30 days';
  v_total_candidates int := 0;
  v_blocked_cooldown int := 0;
  v_blocked_active_chat int := 0;
  v_blocked_incoming int := 0;
  v_blocked_recent_purchase int := 0;
  v_eligible int := 0;
  v_result jsonb;
BEGIN
  CREATE TEMP TABLE _candidates ON COMMIT DROP AS
  SELECT
    zc.id, zc.first_name, zc.last_name, zc.phone, zc.rfm_segment,
    zc.rfm_total_score, zc.last_purchase_at, zc.total_spent, zc.avg_ticket,
    zc.total_orders, zc.preferred_style, zc.shoe_size, zc.cashback_balance, zc.tags,
    right(regexp_replace(zc.phone, '[^0-9]', '', 'g'), 8) as phone_suffix
  FROM zoppy_customers zc
  WHERE zc.phone IS NOT NULL
    AND zc.total_orders > 0
    AND zc.last_purchase_at <= v_45_days_ago
    AND zc.last_purchase_at >= v_730_days_ago;

  SELECT count(*) INTO v_total_candidates FROM _candidates;

  CREATE TEMP TABLE _blocked_cooldown ON COMMIT DROP AS
  SELECT DISTINCT c.id FROM _candidates c
  WHERE EXISTS (
    SELECT 1 FROM whatsapp_messages wm
    WHERE right(regexp_replace(wm.phone, '[^0-9]', '', 'g'), 8) = c.phone_suffix
      AND wm.direction = 'outgoing'
      AND wm.created_at >= v_now - (
        CASE COALESCE(c.rfm_segment, '')
          WHEN 'champions' THEN interval '21 days'
          WHEN 'loyal_customers' THEN interval '14 days'
          WHEN 'at_risk' THEN interval '10 days'
          WHEN 'hibernating' THEN interval '7 days'
          WHEN 'new_customers' THEN interval '14 days'
          ELSE interval '7 days'
        END
      )
  );
  SELECT count(*) INTO v_blocked_cooldown FROM _blocked_cooldown;

  CREATE TEMP TABLE _blocked_incoming ON COMMIT DROP AS
  SELECT DISTINCT c.id FROM _candidates c
  WHERE c.id NOT IN (SELECT id FROM _blocked_cooldown)
    AND EXISTS (
      SELECT 1 FROM whatsapp_messages wm
      WHERE right(regexp_replace(wm.phone, '[^0-9]', '', 'g'), 8) = c.phone_suffix
        AND wm.direction = 'incoming'
        AND wm.created_at >= v_30_days_ago
    );
  SELECT count(*) INTO v_blocked_incoming FROM _blocked_incoming;

  CREATE TEMP TABLE _blocked_chat ON COMMIT DROP AS
  SELECT DISTINCT c.id FROM _candidates c
  WHERE c.id NOT IN (SELECT id FROM _blocked_cooldown)
    AND c.id NOT IN (SELECT id FROM _blocked_incoming)
    AND EXISTS (
      SELECT 1 FROM chat_conversation_assignments cca
      WHERE right(regexp_replace(cca.phone, '[^0-9]', '', 'g'), 8) = c.phone_suffix
    );
  SELECT count(*) INTO v_blocked_active_chat FROM _blocked_chat;

  CREATE TEMP TABLE _blocked_purchase ON COMMIT DROP AS
  SELECT DISTINCT c.id FROM _candidates c
  WHERE c.id NOT IN (SELECT id FROM _blocked_cooldown)
    AND c.id NOT IN (SELECT id FROM _blocked_incoming)
    AND c.id NOT IN (SELECT id FROM _blocked_chat)
    AND EXISTS (
      SELECT 1 FROM pos_sales ps
      JOIN pos_customers pc ON pc.id = ps.customer_id
      WHERE right(regexp_replace(COALESCE(pc.whatsapp, ''), '[^0-9]', '', 'g'), 8) = c.phone_suffix
        AND ps.created_at >= v_30_days_ago
        AND ps.status != 'cancelled'
    );
  SELECT count(*) INTO v_blocked_recent_purchase FROM _blocked_purchase;

  v_eligible := v_total_candidates - v_blocked_cooldown - v_blocked_incoming - v_blocked_active_chat - v_blocked_recent_purchase;

  SELECT jsonb_build_object(
    'filter_summary', jsonb_build_object(
      'total_candidates', v_total_candidates,
      'clientes_elegiveis', v_eligible,
      'bloqueados_cooldown', v_blocked_cooldown,
      'bloqueados_atendimento_ativo', v_blocked_incoming + v_blocked_active_chat,
      'bloqueados_incoming', v_blocked_incoming,
      'bloqueados_chat_aberto', v_blocked_active_chat,
      'bloqueados_compra_recente', v_blocked_recent_purchase,
      'total_filtrado', v_blocked_cooldown + v_blocked_incoming + v_blocked_active_chat + v_blocked_recent_purchase
    ),
    'customers', COALESCE((
      SELECT jsonb_agg(row_to_json(eligible) ORDER BY eligible.rfm_total_score DESC, eligible.total_spent DESC)
      FROM (
        SELECT c.first_name, c.last_name, c.phone, c.rfm_segment, c.rfm_total_score,
               c.last_purchase_at, c.total_spent, c.avg_ticket, c.total_orders,
               c.preferred_style, c.shoe_size, c.cashback_balance, c.tags
        FROM _candidates c
        WHERE c.id NOT IN (SELECT id FROM _blocked_cooldown)
          AND c.id NOT IN (SELECT id FROM _blocked_incoming)
          AND c.id NOT IN (SELECT id FROM _blocked_chat)
          AND c.id NOT IN (SELECT id FROM _blocked_purchase)
        ORDER BY c.rfm_total_score DESC, c.total_spent DESC
        LIMIT p_limit
      ) eligible
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
