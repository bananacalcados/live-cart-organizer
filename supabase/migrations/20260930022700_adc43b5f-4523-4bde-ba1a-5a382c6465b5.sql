CREATE OR REPLACE VIEW public.v_live_buyer_purchase_number WITH (security_invoker=on) AS
WITH s AS (
  SELECT ps.id AS sale_id, ps.created_at, COALESCE(ps.total,0) AS total, ps.event_id,
    right(regexp_replace(ps.customer_phone,'\D','','g'),8) AS phone_key,
    (ps.event_id IS NOT NULL OR ps.source_order_id IS NOT NULL OR ps.sales_channel ILIKE '%live%') AS is_live
  FROM public.pos_sales ps
  WHERE ps.status_cancelamento = 'ativo'
    AND length(regexp_replace(COALESCE(ps.customer_phone,''),'\D','','g')) >= 8
)
SELECT s.*, row_number() OVER (PARTITION BY phone_key ORDER BY created_at, sale_id) AS purchase_number
FROM s;

CREATE OR REPLACE VIEW public.v_live_first_purchase_cohort WITH (security_invoker=on) AS
WITH f AS (
  SELECT DISTINCT ON (phone_key) phone_key, sale_id AS first_live_sale_id, created_at AS first_live_at,
    event_id AS first_live_event_id, total AS first_live_total, purchase_number AS first_live_purchase_number
  FROM public.v_live_buyer_purchase_number WHERE is_live
  ORDER BY phone_key, created_at, sale_id
)
SELECT f.*,
  date_trunc('month', f.first_live_at AT TIME ZONE 'America/Sao_Paulo')::date AS cohort_month,
  (f.first_live_purchase_number > 1) AS was_customer_before,
  EXISTS (SELECT 1 FROM public.v_live_buyer_purchase_number x WHERE x.phone_key=f.phone_key AND x.purchase_number>f.first_live_purchase_number AND x.created_at <= f.first_live_at + interval '60 days') AS repurchase_60d,
  EXISTS (SELECT 1 FROM public.v_live_buyer_purchase_number x WHERE x.phone_key=f.phone_key AND x.is_live AND x.purchase_number>f.first_live_purchase_number AND x.created_at <= f.first_live_at + interval '60 days') AS repurchase_60d_live,
  EXISTS (SELECT 1 FROM public.v_live_buyer_purchase_number x WHERE x.phone_key=f.phone_key AND x.purchase_number>f.first_live_purchase_number AND x.created_at <= f.first_live_at + interval '90 days') AS repurchase_90d,
  (SELECT count(*) FROM public.v_live_buyer_purchase_number x WHERE x.phone_key=f.phone_key AND x.purchase_number>=f.first_live_purchase_number AND x.created_at <= f.first_live_at + interval '90 days') AS purchases_90d,
  (SELECT COALESCE(sum(x.total),0) FROM public.v_live_buyer_purchase_number x WHERE x.phone_key=f.phone_key AND x.purchase_number>=f.first_live_purchase_number AND x.created_at <= f.first_live_at + interval '90 days') AS revenue_90d,
  (now() - f.first_live_at) AS age
FROM f;

GRANT SELECT ON public.v_live_buyer_purchase_number, public.v_live_first_purchase_cohort TO authenticated, service_role;

-- A) Recompra desta live
CREATE OR REPLACE FUNCTION public.event_live_repurchase(p_event_id uuid, p_only_prior_customers boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
WITH ev AS (
  SELECT DISTINCT ON (phone_key) phone_key, sale_id, created_at, purchase_number
  FROM v_live_buyer_purchase_number WHERE event_id = p_event_id
  ORDER BY phone_key, created_at, sale_id
),
evrev AS (SELECT phone_key, sum(total) rev FROM v_live_buyer_purchase_number WHERE event_id=p_event_id GROUP BY phone_key),
base AS (
  SELECT ev.*, r.rev FROM ev JOIN evrev r USING (phone_key)
  WHERE NOT p_only_prior_customers OR EXISTS (
    SELECT 1 FROM v_live_first_purchase_cohort c WHERE c.phone_key=ev.phone_key AND c.first_live_event_id=p_event_id AND c.was_customer_before)
),
tgt AS (SELECT * FROM base WHERE p_only_prior_customers OR purchase_number=1),
rep AS (
  SELECT t.phone_key,
    EXISTS (SELECT 1 FROM v_live_buyer_purchase_number x WHERE x.phone_key=t.phone_key AND x.purchase_number>t.purchase_number AND (x.event_id IS DISTINCT FROM p_event_id)) any_ever,
    EXISTS (SELECT 1 FROM v_live_buyer_purchase_number x WHERE x.phone_key=t.phone_key AND x.purchase_number>t.purchase_number AND x.is_live AND (x.event_id IS DISTINCT FROM p_event_id)) live_ever,
    EXISTS (SELECT 1 FROM v_live_buyer_purchase_number x WHERE x.phone_key=t.phone_key AND x.purchase_number>t.purchase_number AND (x.event_id IS DISTINCT FROM p_event_id) AND x.created_at<=t.created_at+interval '60 days') any_60,
    EXISTS (SELECT 1 FROM v_live_buyer_purchase_number x WHERE x.phone_key=t.phone_key AND x.purchase_number>t.purchase_number AND x.is_live AND (x.event_id IS DISTINCT FROM p_event_id) AND x.created_at<=t.created_at+interval '60 days') live_60
  FROM tgt t
)
SELECT jsonb_build_object(
  'total', (SELECT count(*) FROM base),
  'n1', (SELECT count(*) FROM base WHERE purchase_number=1), 'rev1', (SELECT COALESCE(sum(rev),0) FROM base WHERE purchase_number=1),
  'n2', (SELECT count(*) FROM base WHERE purchase_number=2), 'rev2', (SELECT COALESCE(sum(rev),0) FROM base WHERE purchase_number=2),
  'n3', (SELECT count(*) FROM base WHERE purchase_number>=3), 'rev3', (SELECT COALESCE(sum(rev),0) FROM base WHERE purchase_number>=3),
  'target', (SELECT count(*) FROM rep),
  'rep_any', (SELECT count(*) FROM rep WHERE any_ever), 'rep_live', (SELECT count(*) FROM rep WHERE live_ever),
  'rep_any_60', (SELECT count(*) FROM rep WHERE any_60), 'rep_live_60', (SELECT count(*) FROM rep WHERE live_60),
  'event_age_days', (SELECT EXTRACT(day FROM now()-min(created_at))::int FROM ev)
);
$$;

-- B) Coortes mensais
CREATE OR REPLACE FUNCTION public.live_repurchase_cohorts(p_filter text DEFAULT 'all')
RETURNS TABLE(cohort_month date, buyers bigint, prior_customers bigint, pct_rep_60 numeric, pct_rep_60_live numeric, pct_rep_90 numeric, pct_2plus_90 numeric, revenue_90d numeric, revenue_per_buyer numeric, partial boolean)
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT c.cohort_month, count(*), count(*) FILTER (WHERE was_customer_before),
    round(100.0*count(*) FILTER (WHERE repurchase_60d)/count(*),1),
    round(100.0*count(*) FILTER (WHERE repurchase_60d_live)/count(*),1),
    round(100.0*count(*) FILTER (WHERE repurchase_90d)/count(*),1),
    round(100.0*count(*) FILTER (WHERE purchases_90d>=2)/count(*),1),
    round(sum(c.revenue_90d),2), round(sum(c.revenue_90d)/count(*),2),
    bool_or(c.age < interval '60 days')
  FROM v_live_first_purchase_cohort c
  WHERE p_filter='all' OR (p_filter='new' AND NOT was_customer_before) OR (p_filter='existing' AND was_customer_before)
  GROUP BY c.cohort_month ORDER BY c.cohort_month DESC;
$$;

GRANT EXECUTE ON FUNCTION public.event_live_repurchase(uuid, boolean), public.live_repurchase_cohorts(text) TO authenticated, service_role;