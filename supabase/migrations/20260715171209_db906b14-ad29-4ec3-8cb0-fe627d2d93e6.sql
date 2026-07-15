
-- =============================================================================
-- ETAPA B — Enforcement server-side de cotas mensais + provider cost
-- =============================================================================

-- 1) Colunas em dispatch_history
ALTER TABLE public.dispatch_history
  ADD COLUMN IF NOT EXISTS tipo_comunicacao text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS quota_check_summary jsonb,
  ADD COLUMN IF NOT EXISTS manual_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

-- tipo_comunicacao aceita apenas valores conhecidos (ou NULL para legado)
ALTER TABLE public.dispatch_history DROP CONSTRAINT IF EXISTS dispatch_history_tipo_comunicacao_check;
ALTER TABLE public.dispatch_history ADD CONSTRAINT dispatch_history_tipo_comunicacao_check
  CHECK (tipo_comunicacao IS NULL OR tipo_comunicacao IN
    ('convite_live','oferta','reativacao','lancamento','pesquisa'));

COMMENT ON COLUMN public.dispatch_history.tipo_comunicacao IS
  'Tipo do disparo; validado contra tipos_permitidos de dispatch_touch_limits.';
COMMENT ON COLUMN public.dispatch_history.provider IS
  'Provedor do canal (meta_cloud/uazapi/zapi/wasender); usado para cálculo de custo.';
COMMENT ON COLUMN public.dispatch_history.quota_check_summary IS
  'Snapshot do check_touch_quota no momento do enqueue: totais, exclusões por motivo, custo estimado.';
COMMENT ON COLUMN public.dispatch_history.manual_overrides IS
  'Lista de {unified_id, phone, motivo_original, override_by, override_at} para inclusões manuais.';

-- 2) Colunas em dispatch_recipients
ALTER TABLE public.dispatch_recipients
  ADD COLUMN IF NOT EXISTS unified_customer_id uuid REFERENCES public.customers_unified(id),
  ADD COLUMN IF NOT EXISTS override_reason text;

CREATE INDEX IF NOT EXISTS idx_dispatch_recipients_unified
  ON public.dispatch_recipients(unified_customer_id)
  WHERE unified_customer_id IS NOT NULL;

-- =============================================================================
-- 3) check_touch_quota — avalia elegibilidade de cada candidato
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_touch_quota(
  p_candidates jsonb,             -- [{ "unified_id": uuid, "phone": text }, ...]
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
  -- Valida tipo_comunicacao
  IF p_tipo_comunicacao IS NULL OR p_tipo_comunicacao = '' THEN
    RAISE EXCEPTION 'tipo_comunicacao é obrigatório';
  END IF;
  IF p_tipo_comunicacao NOT IN ('convite_live','oferta','reativacao','lancamento','pesquisa') THEN
    RAISE EXCEPTION 'tipo_comunicacao inválido: %', p_tipo_comunicacao;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      (elem->>'unified_id')::uuid AS uid,
      NULLIF(elem->>'phone','') AS ph
    FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) elem
  ),
  cust AS (
    SELECT
      c.uid,
      c.ph,
      cu.id            AS cu_id,
      cu.name          AS cu_name,
      cu.phone_e164,
      cu.phone_suffix8,
      cu.merged_into_id,
      cu.is_banned,
      cu.opt_out_mass_dispatch,
      cu.classificacao_disparo,
      cu.last_engagement_at
    FROM candidates c
    LEFT JOIN public.customers_unified cu ON cu.id = c.uid
  ),
  -- Regras por classe (cota + tipos permitidos + espaçamento)
  rules AS (
    SELECT classificacao, cota_mensal, tipos_permitidos, min_dias_entre_toques
    FROM public.dispatch_touch_limits
  ),
  -- Toques ENTREGUES no mês corrente (delivered/read) — por sufixo de telefone
  delivered_counts AS (
    SELECT
      right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8) AS sfx8,
      count(*)::int AS n,
      max(coalesce(dr.sent_at, dr.created_at)) AS last_at
    FROM public.dispatch_recipients dr
    JOIN public.dispatch_history dh ON dh.id = dr.dispatch_id
    WHERE dr.status IN ('sent','delivered','read')
      AND coalesce(dr.sent_at, dr.created_at) >= v_month_start
      AND (p_exclude_dispatch_id IS NULL OR dr.dispatch_id <> p_exclude_dispatch_id)
    GROUP BY 1
  ),
  -- Toques PENDENTES/AGENDADOS em campanhas ainda não finalizadas
  pending_counts AS (
    SELECT
      right(regexp_replace(coalesce(dr.phone,''), '\D', '', 'g'), 8) AS sfx8,
      count(*)::int AS n
    FROM public.dispatch_recipients dr
    JOIN public.dispatch_history dh ON dh.id = dr.dispatch_id
    WHERE dr.status IN ('pending','leased')
      AND dh.status IN ('scheduled','scheduled_paused','sending','pending')
      AND (p_exclude_dispatch_id IS NULL OR dr.dispatch_id <> p_exclude_dispatch_id)
    GROUP BY 1
  ),
  agg AS (
    SELECT
      cust.*,
      COALESCE(dc.n,0) + COALESCE(pc.n,0) AS toques_mes,
      dc.last_at AS last_touch,
      COALESCE(cust.classificacao_disparo, 'sem_classificacao') AS cls
    FROM cust
    LEFT JOIN delivered_counts dc ON dc.sfx8 = cust.phone_suffix8
    LEFT JOIN pending_counts   pc ON pc.sfx8 = cust.phone_suffix8
  )
  SELECT
    a.uid,
    COALESCE(a.phone_e164, a.ph) AS phone,
    a.cu_name,
    a.cls,
    -- eligible
    CASE
      WHEN a.cu_id IS NULL                                THEN false
      WHEN a.merged_into_id IS NOT NULL                   THEN false
      WHEN a.phone_e164 IS NULL OR a.phone_e164 = ''      THEN false
      WHEN a.is_banned                                    THEN false
      WHEN COALESCE(a.opt_out_mass_dispatch,false)        THEN false
      WHEN a.cls IN ('silencio','silencio_puro','silencio_reativavel') THEN false
      WHEN r.classificacao IS NULL                        THEN false  -- sem regra pra classe
      WHEN r.cota_mensal <= 0                             THEN false
      WHEN NOT (p_tipo_comunicacao = ANY(r.tipos_permitidos)) THEN false
      WHEN a.toques_mes >= r.cota_mensal                  THEN false
      WHEN r.min_dias_entre_toques IS NOT NULL
           AND a.last_touch IS NOT NULL
           AND a.last_touch > (now() - (r.min_dias_entre_toques || ' days')::interval)
                                                          THEN false
      ELSE true
    END,
    -- reason
    CASE
      WHEN a.cu_id IS NULL                                THEN 'customer_nao_encontrado'
      WHEN a.merged_into_id IS NOT NULL                   THEN 'merged'
      WHEN a.phone_e164 IS NULL OR a.phone_e164 = ''      THEN 'sem_telefone'
      WHEN a.is_banned                                    THEN 'bloqueado'
      WHEN COALESCE(a.opt_out_mass_dispatch,false)        THEN 'opt_out'
      WHEN a.cls = 'silencio_puro'                        THEN 'silencio_puro'
      WHEN a.cls = 'silencio_reativavel'                  THEN 'silencio_reativavel'
      WHEN a.cls = 'silencio'                             THEN 'silencio_legado'
      WHEN r.classificacao IS NULL                        THEN 'sem_classificacao'
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
  LEFT JOIN rules r ON r.classificacao = a.cls;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_touch_quota(jsonb, text, text, uuid) TO authenticated, service_role;

-- =============================================================================
-- 4) dispatch_quota_summary — resumo pronto pra UI
-- =============================================================================
CREATE OR REPLACE FUNCTION public.dispatch_quota_summary(
  p_candidates jsonb,
  p_tipo_comunicacao text,
  p_provider text DEFAULT NULL,
  p_exclude_dispatch_id uuid DEFAULT NULL,
  p_sample_size int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows record;
  v_total int := 0;
  v_eligible int := 0;
  v_excluded_by_reason jsonb := '{}'::jsonb;
  v_sample jsonb := '[]'::jsonb;
  v_cost numeric(10,4) := 0;
  v_cost_per_msg numeric(10,4) := 0;
  v_sample_by_reason jsonb := '{}'::jsonb;
  r jsonb;
BEGIN
  -- custo por mensagem do provider
  IF p_provider IS NOT NULL THEN
    SELECT cost_per_message_brl INTO v_cost_per_msg
    FROM public.provider_costs WHERE provider = p_provider;
    v_cost_per_msg := COALESCE(v_cost_per_msg, 0);
  END IF;

  -- monta agregados
  WITH q AS (
    SELECT * FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_exclude_dispatch_id)
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE eligible)::int,
    COALESCE(
      jsonb_object_agg(reason, cnt) FILTER (WHERE reason IS NOT NULL AND cnt > 0),
      '{}'::jsonb
    )
  INTO v_total, v_eligible, v_excluded_by_reason
  FROM (
    SELECT reason, count(*)::int AS cnt, bool_or(eligible) AS any_eligible
    FROM q
    WHERE NOT eligible
    GROUP BY reason
  ) x;

  -- amostra dos excluídos (até p_sample_size, distribuída entre motivos)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_sample
  FROM (
    SELECT unified_id, phone, name, classificacao, reason, toques_no_mes, last_touch_at
    FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_exclude_dispatch_id)
    WHERE NOT eligible
    ORDER BY reason, name NULLS LAST
    LIMIT GREATEST(p_sample_size, 1)
  ) t;

  v_cost := v_cost_per_msg * v_eligible;

  RETURN jsonb_build_object(
    'total', v_total,
    'eligible', v_eligible,
    'excluded_total', v_total - v_eligible,
    'excluded_by_reason', COALESCE(v_excluded_by_reason, '{}'::jsonb),
    'sample_excluded', v_sample,
    'provider', p_provider,
    'cost_per_message_brl', v_cost_per_msg,
    'estimated_cost_brl', v_cost,
    'tipo_comunicacao', p_tipo_comunicacao,
    'checked_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_quota_summary(jsonb, text, text, uuid, int) TO authenticated, service_role;

-- =============================================================================
-- 5) enqueue_dispatch_recipients_guarded — única forma segura de inserir
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_dispatch_recipients_guarded(
  p_dispatch_id uuid,
  p_candidates jsonb,           -- [{unified_id, phone, name?}, ...]
  p_tipo_comunicacao text,
  p_provider text DEFAULT NULL,
  p_overrides jsonb DEFAULT '[]'::jsonb  -- [{unified_id, motivo}, ...] força inclusão
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_overridden int := 0;
  v_summary jsonb;
  v_overrides_meta jsonb := '[]'::jsonb;
  v_actor uuid := auth.uid();
BEGIN
  IF p_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'p_dispatch_id required';
  END IF;
  IF p_tipo_comunicacao IS NULL THEN
    RAISE EXCEPTION 'tipo_comunicacao é obrigatório para qualquer disparo';
  END IF;

  -- 1. calcula summary (também valida tipo)
  v_summary := public.dispatch_quota_summary(p_candidates, p_tipo_comunicacao, p_provider, p_dispatch_id, 20);

  -- 2. insere eligíveis
  WITH q AS (
    SELECT * FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_dispatch_id)
  ),
  cand_names AS (
    SELECT
      (elem->>'unified_id')::uuid AS uid,
      NULLIF(elem->>'name','') AS nm
    FROM jsonb_array_elements(COALESCE(p_candidates,'[]'::jsonb)) elem
  ),
  overrides AS (
    SELECT
      (o->>'unified_id')::uuid AS uid,
      NULLIF(o->>'motivo','') AS motivo
    FROM jsonb_array_elements(COALESCE(p_overrides,'[]'::jsonb)) o
  ),
  ins AS (
    INSERT INTO public.dispatch_recipients
      (dispatch_id, phone, recipient_name, status, unified_customer_id, override_reason)
    SELECT
      p_dispatch_id,
      q.phone,
      COALESCE(cn.nm, q.name),
      'pending',
      q.unified_id,
      CASE WHEN ov.uid IS NOT NULL THEN concat('override:', COALESCE(ov.motivo,'sem_motivo'), '|', q.reason) ELSE NULL END
    FROM q
    LEFT JOIN cand_names cn ON cn.uid = q.unified_id
    LEFT JOIN overrides ov ON ov.uid = q.unified_id
    WHERE q.phone IS NOT NULL
      AND (q.eligible OR ov.uid IS NOT NULL)
    ON CONFLICT (dispatch_id, phone) DO NOTHING
    RETURNING id, override_reason
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE override_reason IS NOT NULL)
  INTO v_inserted, v_overridden
  FROM ins;

  -- 3. metadata dos overrides
  IF jsonb_array_length(COALESCE(p_overrides,'[]'::jsonb)) > 0 THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'unified_id', o->>'unified_id',
        'motivo', o->>'motivo',
        'override_by', v_actor,
        'override_at', now()
      )
    ) INTO v_overrides_meta
    FROM jsonb_array_elements(p_overrides) o;
  END IF;

  -- 4. persiste no dispatch_history
  UPDATE public.dispatch_history SET
    tipo_comunicacao = COALESCE(tipo_comunicacao, p_tipo_comunicacao),
    provider = COALESCE(provider, p_provider),
    quota_check_summary = v_summary,
    manual_overrides = COALESCE(manual_overrides,'[]'::jsonb) || COALESCE(v_overrides_meta,'[]'::jsonb),
    total_recipients = v_inserted
  WHERE id = p_dispatch_id;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'overridden', v_overridden,
    'summary', v_summary
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_dispatch_recipients_guarded(uuid, jsonb, text, text, jsonb)
  TO authenticated, service_role;
