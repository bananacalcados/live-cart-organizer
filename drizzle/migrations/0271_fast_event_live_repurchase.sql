CREATE INDEX IF NOT EXISTS idx_pos_sales_phone_key8 ON public.pos_sales ((right(regexp_replace(customer_phone, '\D', '', 'g'), 8))) WHERE status_cancelamento = 'ativo';

CREATE OR REPLACE FUNCTION public.event_live_repurchase(p_event_id uuid, p_only_prior_customers boolean DEFAULT false)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
WITH keys AS (
  SELECT DISTINCT right(regexp_replace(customer_phone, '\D', '', 'g'), 8) k
  FROM pos_sales
  WHERE event_id = p_event_id AND status_cancelamento = 'ativo'
    AND length(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g')) >= 8
),
s AS MATERIALIZED (
  SELECT ps.id sale_id, ps.created_at, COALESCE(ps.total,0) total, ps.event_id,
    right(regexp_replace(ps.customer_phone, '\D', '', 'g'), 8) phone_key,
    (ps.event_id IS NOT NULL OR ps.source_order_id IS NOT NULL OR ps.sales_channel ILIKE '%live%') is_live
  FROM pos_sales ps JOIN keys ON right(regexp_replace(ps.customer_phone, '\D', '', 'g'), 8) = keys.k
  WHERE ps.status_cancelamento = 'ativo'
    AND length(regexp_replace(COALESCE(ps.customer_phone, ''), '\D', '', 'g')) >= 8
),
v AS MATERIALIZED (
  SELECT s.*, row_number() OVER (PARTITION BY phone_key ORDER BY created_at, sale_id) purchase_number FROM s
),
firstlive AS (
  SELECT DISTINCT ON (phone_key) phone_key, event_id, purchase_number FROM v WHERE is_live ORDER BY phone_key, created_at, sale_id
),
ev AS (
  SELECT DISTINCT ON (phone_key) phone_key, sale_id, created_at, purchase_number
  FROM v WHERE event_id = p_event_id ORDER BY phone_key, created_at, sale_id
),
evrev AS (SELECT phone_key, sum(total) rev FROM v WHERE event_id = p_event_id GROUP BY phone_key),
base AS (
  SELECT ev.*, r.rev FROM ev JOIN evrev r USING (phone_key)
  WHERE NOT p_only_prior_customers OR EXISTS (
    SELECT 1 FROM firstlive f WHERE f.phone_key = ev.phone_key AND f.event_id = p_event_id AND f.purchase_number > 1)
),
tgt AS (SELECT * FROM base WHERE p_only_prior_customers OR purchase_number = 1),
rep AS (
  SELECT t.phone_key,
    bool_or(x.sale_id IS NOT NULL) any_ever,
    bool_or(x.is_live) live_ever,
    bool_or(x.created_at <= t.created_at + interval '60 days') any_60,
    bool_or(x.is_live AND x.created_at <= t.created_at + interval '60 days') live_60
  FROM tgt t LEFT JOIN v x ON x.phone_key = t.phone_key AND x.purchase_number > t.purchase_number
    AND x.event_id IS DISTINCT FROM p_event_id
  GROUP BY t.phone_key
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
$function$;