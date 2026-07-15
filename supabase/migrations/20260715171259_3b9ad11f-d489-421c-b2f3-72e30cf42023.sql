
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
  v_total int := 0;
  v_eligible int := 0;
  v_excluded_by_reason jsonb := '{}'::jsonb;
  v_sample jsonb := '[]'::jsonb;
  v_cost numeric(10,4) := 0;
  v_cost_per_msg numeric(10,4) := 0;
BEGIN
  IF p_provider IS NOT NULL THEN
    SELECT cost_per_message_brl INTO v_cost_per_msg
    FROM public.provider_costs WHERE provider = p_provider;
    v_cost_per_msg := COALESCE(v_cost_per_msg, 0);
  END IF;

  -- totais
  SELECT count(*)::int, count(*) FILTER (WHERE q.eligible)::int
    INTO v_total, v_eligible
  FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_exclude_dispatch_id) q;

  -- quebra por motivo (apenas exclusões)
  SELECT COALESCE(jsonb_object_agg(reason, cnt), '{}'::jsonb)
    INTO v_excluded_by_reason
  FROM (
    SELECT q.reason, count(*)::int AS cnt
    FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_exclude_dispatch_id) q
    WHERE NOT q.eligible
    GROUP BY q.reason
  ) x;

  -- amostra dos excluídos (até p_sample_size)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_sample
  FROM (
    SELECT q.unified_id, q.phone, q.name, q.classificacao, q.reason, q.toques_no_mes, q.last_touch_at
    FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_exclude_dispatch_id) q
    WHERE NOT q.eligible
    ORDER BY q.reason, q.name NULLS LAST
    LIMIT GREATEST(p_sample_size, 1)
  ) t;

  v_cost := v_cost_per_msg * v_eligible;

  RETURN jsonb_build_object(
    'total', v_total,
    'eligible', v_eligible,
    'excluded_total', v_total - v_eligible,
    'excluded_by_reason', v_excluded_by_reason,
    'sample_excluded', v_sample,
    'provider', p_provider,
    'cost_per_message_brl', v_cost_per_msg,
    'estimated_cost_brl', v_cost,
    'tipo_comunicacao', p_tipo_comunicacao,
    'checked_at', now()
  );
END;
$$;
