
CREATE OR REPLACE FUNCTION public.event_lead_cohorts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH leads AS (
    SELECT
      el.id AS lead_id,
      el.source,
      el.created_at AS captured_at,
      el.phone_suffix,
      el.name,
      el.phone
    FROM public.event_leads el
    WHERE el.event_id = p_event_id
      AND el.phone_suffix IS NOT NULL
      AND length(el.phone_suffix) = 8
  ),
  matched AS (
    SELECT DISTINCT ON (l.lead_id)
      l.lead_id,
      l.source,
      l.captured_at,
      l.name,
      l.phone,
      cu.id AS customer_id,
      cu.first_purchase_at,
      cu.last_purchase_at,
      cu.total_orders,
      cu.total_spent
    FROM leads l
    LEFT JOIN public.customers_unified cu
      ON cu.phone_suffix8 = l.phone_suffix
    ORDER BY l.lead_id, cu.total_spent DESC NULLS LAST
  ),
  classified AS (
    SELECT
      m.*,
      CASE
        WHEN m.customer_id IS NULL OR m.first_purchase_at IS NULL THEN 'nao_convertido'
        WHEN m.first_purchase_at < m.captured_at THEN 'reativado_pre_lead'
        WHEN COALESCE(m.total_orders,0) >= 2 THEN 'novo_recorrente'
        ELSE 'novo_1_compra'
      END AS cohort,
      CASE
        WHEN m.first_purchase_at IS NOT NULL AND m.first_purchase_at >= m.captured_at
          THEN EXTRACT(EPOCH FROM (m.first_purchase_at - m.captured_at))/86400.0
        ELSE NULL
      END AS days_to_first_purchase
    FROM matched m
  ),
  by_cohort AS (
    SELECT
      source,
      cohort,
      COUNT(*)::int AS leads,
      COALESCE(SUM(total_spent),0)::numeric AS revenue,
      AVG(NULLIF(total_spent,0))::numeric AS avg_ltv,
      AVG(NULLIF(total_orders,0))::numeric AS avg_orders,
      AVG(days_to_first_purchase)::numeric AS avg_days_to_purchase
    FROM classified
    GROUP BY source, cohort
  ),
  by_source AS (
    SELECT source, COUNT(*)::int AS total_leads
    FROM classified GROUP BY source
  )
  SELECT jsonb_build_object(
    'total_leads', (SELECT COUNT(*) FROM leads),
    'sources', (
      SELECT jsonb_agg(jsonb_build_object(
        'source', bs.source,
        'total_leads', bs.total_leads,
        'cohorts', (
          SELECT jsonb_agg(jsonb_build_object(
            'cohort', bc.cohort,
            'leads', bc.leads,
            'revenue', ROUND(bc.revenue,2),
            'avg_ltv', ROUND(COALESCE(bc.avg_ltv,0),2),
            'avg_orders', ROUND(COALESCE(bc.avg_orders,0),2),
            'avg_days_to_purchase', ROUND(COALESCE(bc.avg_days_to_purchase,0),1)
          ))
          FROM by_cohort bc WHERE bc.source = bs.source
        )
      )) FROM by_source bs
    ),
    'leads_detail', (
      SELECT jsonb_agg(jsonb_build_object(
        'lead_id', lead_id,
        'name', name,
        'phone', phone,
        'source', source,
        'cohort', cohort,
        'captured_at', captured_at,
        'first_purchase_at', first_purchase_at,
        'last_purchase_at', last_purchase_at,
        'total_orders', total_orders,
        'total_spent', total_spent,
        'days_to_first_purchase', ROUND(days_to_first_purchase,1)
      ) ORDER BY total_spent DESC NULLS LAST)
      FROM classified
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.event_lead_cohorts(uuid) TO authenticated, service_role;
