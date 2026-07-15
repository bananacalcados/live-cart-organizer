
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
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
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
  -- UNIVERSAL touch feed: cinco filas de campanha
  -- (whatsapp_messages NUNCA entra — atendimento não é campanha)
  touch_feed AS (
    -- 1) MassTemplateDispatcher (dispatch_recipients)
    SELECT right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8) AS sfx8,
           coalesce(dr.sent_at, dr.created_at) AS at_ts,
           (dr.status IN ('sent','delivered','read'))::int AS is_delivered,
           (dr.status IN ('pending','leased'))::int AS is_pending
    FROM public.dispatch_recipients dr
    JOIN public.dispatch_history dh ON dh.id = dr.dispatch_id
    WHERE coalesce(dr.sent_at, dr.created_at) >= v_month_start
      AND (
        (dr.status IN ('sent','delivered','read'))
        OR (dr.status IN ('pending','leased') AND dh.status IN ('scheduled','scheduled_paused','sending','pending'))
      )
      AND (p_exclude_dispatch_id IS NULL OR dr.dispatch_id <> p_exclude_dispatch_id)
      AND coalesce(dr.shadow_mode, false) = false  -- shadow não consome cota real

    UNION ALL
    -- 2) Carrossel 1:1 (campanha_envios)
    SELECT ce.phone_suffix8,
           coalesce(ce.enviado_em, ce.created_at),
           (ce.status IN ('enviado','entregue','lido'))::int,
           (ce.status = 'pendente')::int
    FROM public.campanha_envios ce
    WHERE coalesce(ce.enviado_em, ce.created_at) >= v_month_start
      AND ce.status IN ('enviado','entregue','lido','pendente')
      AND ce.phone_suffix8 IS NOT NULL
      AND coalesce(ce.shadow_mode, false) = false

    UNION ALL
    -- 3) Live campaign dispatches
    SELECT right(regexp_replace(coalesce(lcd.phone,''), '\D', '', 'g'), 8),
           coalesce(lcd.sent_at, lcd.created_at),
           (lcd.status IN ('sent','delivered','read'))::int,
           (lcd.status = 'pending')::int
    FROM public.live_campaign_dispatches lcd
    WHERE coalesce(lcd.sent_at, lcd.created_at) >= v_month_start
      AND lcd.status IN ('pending','sent','delivered','read')
      AND coalesce(lcd.shadow_mode, false) = false

    UNION ALL
    -- 4) Órfãos VIP (mass_dispatch_targets)
    SELECT mdt.phone_suffix8,
           coalesce(mdt.sent_at, mdt.created_at),
           (mdt.status = 'sent')::int,
           (mdt.status = 'pending')::int
    FROM public.mass_dispatch_targets mdt
    WHERE coalesce(mdt.sent_at, mdt.created_at) >= v_month_start
      AND mdt.status IN ('pending','sent')
      AND coalesce(mdt.shadow_mode, false) = false

    UNION ALL
    -- 5) Automations (automation_dispatch_sent)
    SELECT right(regexp_replace(coalesce(ads.phone,''), '\D', '', 'g'), 8),
           ads.sent_at,
           (ads.status = 'sent')::int,
           0
    FROM public.automation_dispatch_sent ads
    WHERE ads.sent_at >= v_month_start
      AND ads.status = 'sent'
      AND coalesce(ads.shadow_mode, false) = false
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
    a.uid,
    COALESCE(a.phone_e164, a.ph),
    a.cu_name,
    a.cls,
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
    a.toques_mes,
    a.last_touch
  FROM agg a
  LEFT JOIN rules r ON r.rule_class = a.cls;
END;
$function$;

COMMENT ON FUNCTION public.check_touch_quota(jsonb,text,text,uuid) IS
'v2: contagem universal cross-produto — soma dispatch_recipients + campanha_envios + live_campaign_dispatches + mass_dispatch_targets + automation_dispatch_sent. whatsapp_messages nunca entra. shadow_mode=true não consome cota real.';
