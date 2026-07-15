
-- Adiciona critério-proxy interno ao check de "grande live capturada",
-- para o ciclo não depender de peak_viewers manual.
-- Critérios (OR):
--   A) live_sessions em sábado/domingo com peak_viewers >= min_big_live_viewers (legado)
--   B) em sábado/domingo dentro do ciclo, soma de destinatários enfileirados em
--      campanhas com tipo_comunicacao='convite_live' >= min_convite_live_recipients
--      (soma campanha_envios + live_campaign_dispatches criados desde started_at)
-- Registra a evidência usada em `notes` (json com criterio + volume/id).

ALTER TABLE public.shadow_cycle_state
  ADD COLUMN IF NOT EXISTS min_convite_live_recipients integer NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS captured_criterion text;

CREATE OR REPLACE FUNCTION public.shadow_cycle_check_big_live()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state public.shadow_cycle_state;
  v_live record;
  v_proxy_count int;
  v_proxy_ref jsonb;
BEGIN
  SELECT * INTO v_state FROM public.shadow_cycle_state
   WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1;
  IF v_state.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_cycle');
  END IF;
  IF v_state.captured_big_live_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'captured_at', v_state.captured_big_live_at,
      'criterion', v_state.captured_criterion,
      'live_session_id', v_state.captured_live_session_id);
  END IF;

  -- (A) live_sessions com peak_viewers real
  SELECT ls.id, ls.started_at, COALESCE(ls.peak_viewers, 0) AS peak
    INTO v_live
    FROM public.live_sessions ls
   WHERE ls.started_at >= v_state.started_at
     AND EXTRACT(dow FROM ls.started_at) IN (0, 6)
     AND COALESCE(ls.peak_viewers, 0) >= v_state.min_big_live_viewers
   ORDER BY ls.peak_viewers DESC NULLS LAST
   LIMIT 1;

  IF v_live.id IS NOT NULL THEN
    UPDATE public.shadow_cycle_state
       SET captured_big_live_at = now(),
           captured_live_session_id = v_live.id,
           captured_criterion = 'peak_viewers',
           updated_at = now()
     WHERE id = v_state.id;
    RETURN jsonb_build_object('ok', true, 'captured_now', true,
      'criterion', 'peak_viewers',
      'live_session_id', v_live.id, 'peak_viewers', v_live.peak);
  END IF;

  -- (B) Proxy: destinatários convite_live enfileirados em fim de semana >= min
  WITH per_day AS (
    SELECT date_trunc('day', created_at) AS d, count(*) AS cnt
      FROM public.campanha_envios ce
      JOIN public.campanhas_auto ca ON ca.id = ce.campanha_id
     WHERE ce.created_at >= v_state.started_at
       AND ca.tipo_comunicacao = 'convite_live'
       AND EXTRACT(dow FROM ce.created_at) IN (0, 6)
     GROUP BY 1
    UNION ALL
    SELECT date_trunc('day', created_at) AS d, count(*) AS cnt
      FROM public.live_campaign_dispatches lcd
      JOIN public.live_campaigns lc ON lc.id = lcd.campaign_id
     WHERE lcd.created_at >= v_state.started_at
       AND lc.tipo_comunicacao = 'convite_live'
       AND EXTRACT(dow FROM lcd.created_at) IN (0, 6)
     GROUP BY 1
  ), by_day AS (
    SELECT d, sum(cnt)::int AS total FROM per_day GROUP BY d
  )
  SELECT total, jsonb_build_object('day', d, 'recipients', total)
    INTO v_proxy_count, v_proxy_ref
    FROM by_day
   WHERE total >= v_state.min_convite_live_recipients
   ORDER BY total DESC LIMIT 1;

  IF v_proxy_count IS NOT NULL THEN
    UPDATE public.shadow_cycle_state
       SET captured_big_live_at = now(),
           captured_criterion = 'convite_live_volume',
           notes = COALESCE(notes,'') || ' proxy=' || v_proxy_ref::text,
           updated_at = now()
     WHERE id = v_state.id;
    RETURN jsonb_build_object('ok', true, 'captured_now', true,
      'criterion', 'convite_live_volume',
      'proxy', v_proxy_ref);
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'no_big_live_yet',
    'started_at', v_state.started_at,
    'min_viewers', v_state.min_big_live_viewers,
    'min_convite_live_recipients', v_state.min_convite_live_recipients);
END;
$$;
