
CREATE OR REPLACE FUNCTION public.check_touch_quota(
  p_candidates jsonb,
  p_tipo_comunicacao text,
  p_provider text DEFAULT NULL,
  p_exclude_dispatch_id uuid DEFAULT NULL
)
RETURNS TABLE (
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  delivered_counts AS (
    SELECT right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8) AS sfx8,
           count(*)::int AS n,
           max(coalesce(dr.sent_at, dr.created_at)) AS last_at
    FROM public.dispatch_recipients dr
    JOIN public.dispatch_history dh ON dh.id = dr.dispatch_id
    WHERE dr.status IN ('sent','delivered','read')
      AND coalesce(dr.sent_at, dr.created_at) >= v_month_start
      AND (p_exclude_dispatch_id IS NULL OR dr.dispatch_id <> p_exclude_dispatch_id)
    GROUP BY 1
  ),
  pending_counts AS (
    SELECT right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8) AS sfx8,
           count(*)::int AS n
    FROM public.dispatch_recipients dr
    JOIN public.dispatch_history dh ON dh.id = dr.dispatch_id
    WHERE dr.status IN ('pending','leased')
      AND dh.status IN ('scheduled','scheduled_paused','sending','pending')
      AND (p_exclude_dispatch_id IS NULL OR dr.dispatch_id <> p_exclude_dispatch_id)
    GROUP BY 1
  ),
  agg AS (
    SELECT cust.*,
      COALESCE(dc.n,0) + COALESCE(pc.n,0) AS toques_mes,
      dc.last_at AS last_touch,
      COALESCE(cust.classificacao_disparo, 'sem_classificacao') AS cls
    FROM cust
    LEFT JOIN delivered_counts dc ON dc.sfx8 = cust.phone_suffix8
    LEFT JOIN pending_counts   pc ON pc.sfx8 = cust.phone_suffix8
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
      WHEN a.is_banned                                    THEN 'bloqueado'
      WHEN COALESCE(a.opt_out_mass_dispatch,false)        THEN 'opt_out'
      WHEN a.cls = 'silencio_puro'                        THEN 'silencio_puro'
      WHEN a.cls = 'silencio_reativavel'                  THEN 'silencio_reativavel'
      WHEN a.cls = 'silencio'                             THEN 'silencio_legado'
      WHEN r.rule_class IS NULL                           THEN 'sem_classificacao'
      WHEN r.cota_mensal <= 0                             THEN 'cota_zero'
      WHEN NOT (p_tipo_comunicacao = ANY(r.tipos_permitidos))
                                                          THEN 'tipo_incompativel'
      WHEN a.toques_mes >= r.cota_mensal                  THEN 'cota_mensal_atingida'
      WHEN r.min_dias_entre_toques IS NOT NULL
           AND a.last_touch IS NOT NULL
           AND a.last_touch > (now() - (r.min_dias_entre_toques || ' days')::interval)
                                                          THEN 'min_dias_entre_toques'
      ELSE 'ok'
    END,
    a.toques_mes,
    a.last_touch
  FROM agg a
  LEFT JOIN rules r ON r.rule_class = a.cls;
END;
$$;
