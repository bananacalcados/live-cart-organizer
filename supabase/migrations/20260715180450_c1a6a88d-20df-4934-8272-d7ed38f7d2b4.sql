
-- ============================================================================
-- 1) check_touch_quota v2.1 — CORREÇÃO CRÍTICA
-- Shadow-mode desliga apenas o BLOQUEIO, nunca a CONTABILIDADE.
-- Toques entregues em shadow contam; toques pendentes em shadow NÃO reservam
-- (porque sem enforcement eles serão enviados e virarão delivered → contados então).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_touch_quota(
  p_candidates jsonb,
  p_tipo_comunicacao text,
  p_provider text DEFAULT NULL,
  p_exclude_dispatch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  unified_id uuid,
  phone text,
  name text,
  classificacao text,
  eligible boolean,
  reason text,
  toques_no_mes integer,
  last_touch_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_month_start timestamptz := date_trunc('month', now());
BEGIN
  IF p_tipo_comunicacao IS NULL OR p_tipo_comunicacao = '' THEN
    RAISE EXCEPTION 'tipo_comunicacao é obrigatório';
  END IF;
  IF p_tipo_comunicacao NOT IN ('convite_live','oferta','reativacao','lancamento','pesquisa') THEN
    RAISE EXCEPTION 'tipo_comunicacao inválido: %', p_tipo_comunicacao;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT (elem->>'unified_id')::uuid AS uid,
           NULLIF(elem->>'phone','') AS ph
    FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) elem
  ),
  cust AS (
    SELECT c.uid, c.ph,
      cu.id AS cu_id, cu.name AS cu_name,
      cu.phone_e164, cu.phone_suffix8,
      cu.merged_into_id, cu.is_banned,
      cu.opt_out_mass_dispatch,
      cu.classificacao_disparo, cu.last_engagement_at
    FROM candidates c
    LEFT JOIN public.customers_unified cu ON cu.id = c.uid
  ),
  rules AS (
    SELECT dtl.classificacao AS rule_class, dtl.cota_mensal, dtl.tipos_permitidos, dtl.min_dias_entre_toques
    FROM public.dispatch_touch_limits dtl
  ),
  -- Universal touch feed: DELIVERED conta SEMPRE (real ou shadow).
  -- PENDING só reserva quando NÃO shadow (shadow pendente vira delivered depois).
  touch_feed AS (
    -- 1) dispatch_recipients
    SELECT right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8) AS sfx8,
           coalesce(dr.sent_at, dr.created_at) AS at_ts,
           (dr.status IN ('sent','delivered','read'))::int AS is_delivered,
           (dr.status IN ('pending','leased') AND NOT coalesce(dr.shadow_mode,false))::int AS is_pending
    FROM public.dispatch_recipients dr
    JOIN public.dispatch_history dh ON dh.id = dr.dispatch_id
    WHERE coalesce(dr.sent_at, dr.created_at) >= v_month_start
      AND (
        dr.status IN ('sent','delivered','read')
        OR (dr.status IN ('pending','leased') AND dh.status IN ('scheduled','scheduled_paused','sending','pending') AND NOT coalesce(dr.shadow_mode,false))
      )
      AND (p_exclude_dispatch_id IS NULL OR dr.dispatch_id <> p_exclude_dispatch_id)

    UNION ALL
    -- 2) campanha_envios (carrossel Meta)
    SELECT ce.phone_suffix8,
           coalesce(ce.enviado_em, ce.created_at),
           (ce.status IN ('enviado','entregue','lido'))::int,
           (ce.status = 'pendente' AND NOT coalesce(ce.shadow_mode,false))::int
    FROM public.campanha_envios ce
    WHERE coalesce(ce.enviado_em, ce.created_at) >= v_month_start
      AND ce.status IN ('enviado','entregue','lido','pendente')
      AND ce.phone_suffix8 IS NOT NULL

    UNION ALL
    -- 3) live_campaign_dispatches
    SELECT right(regexp_replace(coalesce(lcd.phone,''), '\D', '', 'g'), 8),
           coalesce(lcd.sent_at, lcd.created_at),
           (lcd.status IN ('sent','delivered','read'))::int,
           (lcd.status = 'pending' AND NOT coalesce(lcd.shadow_mode,false))::int
    FROM public.live_campaign_dispatches lcd
    WHERE coalesce(lcd.sent_at, lcd.created_at) >= v_month_start
      AND lcd.status IN ('pending','sent','delivered','read')

    UNION ALL
    -- 4) mass_dispatch_targets (órfãos VIP)
    SELECT mdt.phone_suffix8,
           coalesce(mdt.sent_at, mdt.created_at),
           (mdt.status = 'sent')::int,
           (mdt.status = 'pending' AND NOT coalesce(mdt.shadow_mode,false))::int
    FROM public.mass_dispatch_targets mdt
    WHERE coalesce(mdt.sent_at, mdt.created_at) >= v_month_start
      AND mdt.status IN ('pending','sent')

    UNION ALL
    -- 5) automation_dispatch_sent (sem estado pendente — só marca pós-envio)
    SELECT right(regexp_replace(coalesce(ads.phone,''), '\D', '', 'g'), 8),
           ads.sent_at,
           (ads.status = 'sent')::int,
           0
    FROM public.automation_dispatch_sent ads
    WHERE ads.sent_at >= v_month_start
      AND ads.status = 'sent'
  ),
  touch_agg AS (
    SELECT sfx8,
           sum(is_delivered + is_pending)::int AS total_toques,
           max(at_ts) FILTER (WHERE is_delivered = 1) AS last_delivered
    FROM touch_feed
    WHERE sfx8 IS NOT NULL AND sfx8 <> ''
    GROUP BY sfx8
  ),
  agg AS (
    SELECT cust.*,
      COALESCE(ta.total_toques, 0) AS toques_mes,
      ta.last_delivered AS last_touch,
      COALESCE(cust.classificacao_disparo, 'sem_classificacao') AS cls
    FROM cust
    LEFT JOIN touch_agg ta ON ta.sfx8 = cust.phone_suffix8
  )
  SELECT
    a.uid, COALESCE(a.phone_e164, a.ph), a.cu_name, a.cls,
    CASE
      WHEN a.cu_id IS NULL                                THEN false
      WHEN a.merged_into_id IS NOT NULL                   THEN false
      WHEN a.phone_e164 IS NULL OR a.phone_e164 = ''      THEN false
      WHEN a.is_banned                                    THEN false
      WHEN COALESCE(a.opt_out_mass_dispatch,false)        THEN false
      WHEN a.cls IN ('silencio','silencio_puro','silencio_reativavel') THEN false
      WHEN r.rule_class IS NULL                           THEN false
      WHEN r.cota_mensal <= 0                             THEN false
      WHEN NOT (p_tipo_comunicacao = ANY(r.tipos_permitidos)) THEN false
      WHEN a.toques_mes >= r.cota_mensal                  THEN false
      WHEN r.min_dias_entre_toques IS NOT NULL
           AND a.last_touch IS NOT NULL
           AND a.last_touch > (now() - (r.min_dias_entre_toques || ' days')::interval)
                                                          THEN false
      ELSE true
    END,
    CASE
      WHEN a.cu_id IS NULL                                THEN 'customer_nao_encontrado'
      WHEN a.merged_into_id IS NOT NULL                   THEN 'merged'
      WHEN a.phone_e164 IS NULL OR a.phone_e164 = ''      THEN 'sem_telefone'
      WHEN a.is_banned                                    THEN 'banido'
      WHEN COALESCE(a.opt_out_mass_dispatch,false)        THEN 'opt_out'
      WHEN a.cls IN ('silencio','silencio_puro','silencio_reativavel') THEN 'silencio'
      WHEN r.rule_class IS NULL                           THEN 'classe_sem_regra'
      WHEN r.cota_mensal <= 0                             THEN 'cota_zero'
      WHEN NOT (p_tipo_comunicacao = ANY(r.tipos_permitidos)) THEN 'tipo_nao_permitido'
      WHEN a.toques_mes >= r.cota_mensal                  THEN 'cota_estourada'
      WHEN r.min_dias_entre_toques IS NOT NULL
           AND a.last_touch IS NOT NULL
           AND a.last_touch > (now() - (r.min_dias_entre_toques || ' days')::interval)
                                                          THEN 'cooldown_ativo'
      ELSE 'elegivel'
    END,
    a.toques_mes, a.last_touch
  FROM agg a
  LEFT JOIN rules r ON r.rule_class = a.cls;
END;
$function$;

COMMENT ON FUNCTION public.check_touch_quota(jsonb,text,text,uuid) IS
'v2.1: shadow_mode desliga BLOQUEIO, não CONTABILIDADE. Toques entregues (real ou shadow) contam sempre; pendentes em shadow não reservam (viram delivered depois).';

-- ============================================================================
-- 2) tipo_comunicacao retroativo por produto
-- ============================================================================
ALTER TABLE public.campanhas_auto
  ADD COLUMN IF NOT EXISTS tipo_comunicacao text;
ALTER TABLE public.live_campaigns
  ADD COLUMN IF NOT EXISTS tipo_comunicacao text;

-- Retroativo: campanhas existentes recebem default apropriado ao produto.
UPDATE public.campanhas_auto
   SET tipo_comunicacao = 'oferta'
 WHERE tipo_comunicacao IS NULL;
UPDATE public.live_campaigns
   SET tipo_comunicacao = 'convite_live'
 WHERE tipo_comunicacao IS NULL;

-- Constraint de valores válidos, mas SEM default a nível de coluna (novas linhas
-- devem escolher conscientemente — o app enforça isso no builder).
ALTER TABLE public.campanhas_auto
  DROP CONSTRAINT IF EXISTS campanhas_auto_tipo_comunicacao_check;
ALTER TABLE public.campanhas_auto
  ADD CONSTRAINT campanhas_auto_tipo_comunicacao_check
  CHECK (tipo_comunicacao IN ('convite_live','oferta','reativacao','lancamento','pesquisa'));

ALTER TABLE public.live_campaigns
  DROP CONSTRAINT IF EXISTS live_campaigns_tipo_comunicacao_check;
ALTER TABLE public.live_campaigns
  ADD CONSTRAINT live_campaigns_tipo_comunicacao_check
  CHECK (tipo_comunicacao IN ('convite_live','oferta','reativacao','lancamento','pesquisa'));

-- NOT NULL depois do backfill.
ALTER TABLE public.campanhas_auto ALTER COLUMN tipo_comunicacao SET NOT NULL;
ALTER TABLE public.live_campaigns  ALTER COLUMN tipo_comunicacao SET NOT NULL;

-- ============================================================================
-- 3) shadow_cycle_state — validade do ciclo (precisa cobrir grande live)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shadow_cycle_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  min_days integer NOT NULL DEFAULT 7,
  min_big_live_viewers integer NOT NULL DEFAULT 50,
  captured_big_live_at timestamptz,
  captured_live_session_id uuid,
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shadow_cycle_state TO authenticated;
GRANT ALL ON public.shadow_cycle_state TO service_role;
ALTER TABLE public.shadow_cycle_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read shadow_cycle_state" ON public.shadow_cycle_state;
CREATE POLICY "read shadow_cycle_state" ON public.shadow_cycle_state FOR SELECT TO authenticated USING (true);

-- Seed do ciclo atual (idempotente: só insere se não houver ciclo aberto).
INSERT INTO public.shadow_cycle_state (min_days, min_big_live_viewers)
SELECT 7, 50
WHERE NOT EXISTS (SELECT 1 FROM public.shadow_cycle_state WHERE closed_at IS NULL);

-- Detecta se o ciclo aberto já capturou uma "grande live de fim de semana".
-- Critério: live_sessions em sábado/domingo desde started_at com peak_viewers >= min.
CREATE OR REPLACE FUNCTION public.shadow_cycle_check_big_live()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_state public.shadow_cycle_state;
  v_live record;
BEGIN
  SELECT * INTO v_state FROM public.shadow_cycle_state
   WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1;
  IF v_state.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_cycle');
  END IF;
  IF v_state.captured_big_live_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'captured_at', v_state.captured_big_live_at,
      'live_session_id', v_state.captured_live_session_id);
  END IF;

  SELECT ls.id, ls.started_at, COALESCE(ls.peak_viewers, 0) AS peak
    INTO v_live
    FROM public.live_sessions ls
   WHERE ls.started_at >= v_state.started_at
     AND EXTRACT(dow FROM ls.started_at) IN (0, 6)  -- dom=0, sab=6
     AND COALESCE(ls.peak_viewers, 0) >= v_state.min_big_live_viewers
   ORDER BY ls.peak_viewers DESC NULLS LAST
   LIMIT 1;

  IF v_live.id IS NOT NULL THEN
    UPDATE public.shadow_cycle_state
       SET captured_big_live_at = now(),
           captured_live_session_id = v_live.id,
           updated_at = now()
     WHERE id = v_state.id;
    RETURN jsonb_build_object('ok', true, 'captured_now', true,
      'live_session_id', v_live.id, 'peak_viewers', v_live.peak);
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'no_big_live_yet',
    'started_at', v_state.started_at, 'min_viewers', v_state.min_big_live_viewers);
END;
$$;

-- Elegibilidade do ciclo para relatório: min_days decorridos + big_live capturado.
CREATE OR REPLACE FUNCTION public.shadow_cycle_ready_for_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'cycle_id', s.id,
    'started_at', s.started_at,
    'min_days', s.min_days,
    'days_elapsed', EXTRACT(EPOCH FROM (now() - s.started_at))/86400,
    'big_live_captured', s.captured_big_live_at IS NOT NULL,
    'captured_live_session_id', s.captured_live_session_id,
    'ready', (
      (now() - s.started_at) >= (s.min_days || ' days')::interval
      AND s.captured_big_live_at IS NOT NULL
    )
  )
  FROM public.shadow_cycle_state s
  WHERE s.closed_at IS NULL
  ORDER BY s.started_at DESC LIMIT 1;
$$;

-- ============================================================================
-- 4) shadow_report_period — o que teria sido barrado no ciclo aberto
-- ============================================================================
CREATE OR REPLACE VIEW public.shadow_report_period AS
WITH cycle AS (
  SELECT id AS cycle_id, started_at
    FROM public.shadow_cycle_state
   WHERE closed_at IS NULL
   ORDER BY started_at DESC LIMIT 1
),
sends AS (
  SELECT 'dispatch_recipients'::text AS fila, dr.shadow_mode, dr.status,
         (dr.status IN ('sent','delivered','read')) AS delivered,
         dr.sent_at AS at_ts
    FROM public.dispatch_recipients dr, cycle
   WHERE dr.created_at >= cycle.started_at
  UNION ALL
  SELECT 'campanha_envios', ce.shadow_mode, ce.status,
         (ce.status IN ('enviado','entregue','lido')), ce.enviado_em
    FROM public.campanha_envios ce, cycle
   WHERE ce.created_at >= cycle.started_at
  UNION ALL
  SELECT 'live_campaign_dispatches', lcd.shadow_mode, lcd.status,
         (lcd.status IN ('sent','delivered','read')), lcd.sent_at
    FROM public.live_campaign_dispatches lcd, cycle
   WHERE lcd.created_at >= cycle.started_at
  UNION ALL
  SELECT 'mass_dispatch_targets', mdt.shadow_mode, mdt.status,
         (mdt.status = 'sent'), mdt.sent_at
    FROM public.mass_dispatch_targets mdt, cycle
   WHERE mdt.created_at >= cycle.started_at
)
SELECT fila,
       count(*) FILTER (WHERE shadow_mode)                                AS shadow_inserted,
       count(*) FILTER (WHERE shadow_mode AND delivered)                  AS shadow_delivered,
       count(*) FILTER (WHERE NOT shadow_mode)                            AS enforced_inserted,
       count(*) FILTER (WHERE NOT shadow_mode AND delivered)              AS enforced_delivered,
       min(at_ts)                                                         AS first_send,
       max(at_ts)                                                         AS last_send
FROM sends
GROUP BY fila;

GRANT SELECT ON public.shadow_report_period TO authenticated;

-- ============================================================================
-- 5) Alertas de reclassificação abertos (para o banner do /marketing)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_unack_template_alerts()
RETURNS SETOF public.meta_template_category_alerts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.meta_template_category_alerts
   WHERE acknowledged = false
   ORDER BY detected_at DESC
   LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.list_unack_template_alerts() TO authenticated;
