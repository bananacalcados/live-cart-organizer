CREATE OR REPLACE FUNCTION public.campaign_run_periods()
RETURNS TABLE(campanha_id uuid, primeiro timestamptz, ultimo timestamptz, enviados bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    campanha_id,
    min(enviado_em) AS primeiro,
    max(enviado_em) AS ultimo,
    count(*) FILTER (WHERE status IN ('enviado','entregue','lido')) AS enviados
  FROM campanha_envios
  GROUP BY campanha_id
$function$;

CREATE OR REPLACE FUNCTION public.campaigns_overview_stats(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH envios AS (
  SELECT * FROM campanha_envios
  WHERE enviado_em::date >= p_start AND enviado_em::date <= p_end
),
counts AS (
  SELECT
    count(DISTINCT campanha_id) AS campanhas,
    count(*) AS total,
    count(*) FILTER (WHERE status IN ('enviado','entregue','lido')) AS enviados,
    count(*) FILTER (WHERE status IN ('entregue','lido')) AS entregues,
    count(*) FILTER (WHERE status = 'lido') AS lidos,
    count(*) FILTER (WHERE status = 'falhou') AS falhou,
    count(*) FILTER (WHERE status = 'nao_entregavel') AS nao_entregavel,
    count(*) FILTER (WHERE status = 'pendente') AS pendente
  FROM envios
),
sent AS (
  SELECT id AS envio_id, cliente_id, phone_suffix8, enviado_em::date AS d,
         coalesce(cliente_id::text, phone_suffix8) AS rkey
  FROM envios
  WHERE status IN ('enviado','entregue','lido')
),
qsales AS (
  SELECT DISTINCT ON (ps.id) ps.id AS sale_id, s.rkey, ps.total
  FROM sent s
  JOIN pos_sales ps ON (
        (s.cliente_id IS NOT NULL AND ps.customer_unified_id = s.cliente_id)
     OR (s.phone_suffix8 IS NOT NULL
         AND right(regexp_replace(coalesce(ps.customer_phone, ''), '\D', '', 'g'), 8) = s.phone_suffix8)
  )
  WHERE ps.status IN ('completed','paid')
    AND coalesce(ps.paid_at, ps.created_at)::date >= s.d
    AND coalesce(ps.paid_at, ps.created_at)::date <= add_business_days(s.d, 7)
  ORDER BY ps.id, coalesce(ps.paid_at, ps.created_at)
),
conv AS (
  SELECT
    count(DISTINCT rkey) AS conversoes,
    coalesce(sum(total), 0) AS valor,
    (SELECT coalesce(sum(i.quantity), 0)
       FROM pos_sale_items i
      WHERE i.sale_id IN (SELECT sale_id FROM qsales)) AS itens
  FROM qsales
)
SELECT jsonb_build_object(
  'campanhas', c.campanhas,
  'total', c.total,
  'enviados', c.enviados,
  'entregues', c.entregues,
  'lidos', c.lidos,
  'falhou', c.falhou,
  'nao_entregavel', c.nao_entregavel,
  'pendente', c.pendente,
  'conversoes', cv.conversoes,
  'valor_conversao', cv.valor,
  'itens_vendidos', cv.itens,
  'custo_por_msg', 0.40,
  'custo', round(c.enviados * 0.40, 2),
  'roas', CASE WHEN c.enviados > 0 THEN round(cv.valor / (c.enviados * 0.40), 2) ELSE 0 END,
  'taxa_conversao', CASE WHEN c.enviados > 0 THEN round((cv.conversoes::numeric / c.enviados) * 100, 1) ELSE 0 END,
  'ticket_medio', CASE WHEN cv.conversoes > 0 THEN round(cv.valor / cv.conversoes, 2) ELSE 0 END
)
FROM counts c CROSS JOIN conv cv;
$function$;

CREATE OR REPLACE FUNCTION public.campaigns_overview_conversions(p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH envios AS (
  SELECT * FROM campanha_envios
  WHERE enviado_em::date >= p_start AND enviado_em::date <= p_end
    AND status IN ('enviado','entregue','lido')
),
sent AS (
  SELECT
    e.id AS envio_id, e.campanha_id, e.cliente_id, e.phone, e.phone_suffix8,
    e.enviado_em::date AS d,
    coalesce(e.cliente_id::text, e.phone_suffix8) AS rkey,
    ca.nome AS campanha_nome
  FROM envios e
  LEFT JOIN campanhas_auto ca ON ca.id = e.campanha_id
),
qsales AS (
  SELECT DISTINCT ON (ps.id)
    ps.id AS sale_id, s.campanha_nome, s.phone,
    ps.total, ps.subtotal, ps.discount,
    coalesce(ps.paid_at, ps.created_at) AS sale_date,
    coalesce(nullif(ps.customer_name, ''), 'Cliente') AS customer_name,
    coalesce(ps.customer_phone, s.phone) AS customer_phone,
    coalesce(nullif(ps.payment_method_detail, ''), ps.payment_method) AS payment_method,
    ps.sale_type, ps.seller_id, ps.store_id
  FROM sent s
  JOIN pos_sales ps ON (
        (s.cliente_id IS NOT NULL AND ps.customer_unified_id = s.cliente_id)
     OR (s.phone_suffix8 IS NOT NULL
         AND right(regexp_replace(coalesce(ps.customer_phone, ''), '\D', '', 'g'), 8) = s.phone_suffix8)
  )
  WHERE ps.status IN ('completed','paid')
    AND coalesce(ps.paid_at, ps.created_at)::date >= s.d
    AND coalesce(ps.paid_at, ps.created_at)::date <= add_business_days(s.d, 7)
  ORDER BY ps.id, coalesce(ps.paid_at, ps.created_at)
)
SELECT coalesce(jsonb_agg(sale ORDER BY (sale->>'date') DESC), '[]'::jsonb)
FROM (
  SELECT jsonb_build_object(
    'id', q.sale_id,
    'campanha', q.campanha_nome,
    'customer_name', q.customer_name,
    'customer_phone', q.customer_phone,
    'date', q.sale_date,
    'total', q.total,
    'subtotal', q.subtotal,
    'discount', q.discount,
    'payment_method', q.payment_method,
    'sale_type', q.sale_type,
    'seller', sel.name,
    'store', st.name,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', i.product_name,
        'variant', i.variant_name,
        'size', i.size,
        'qty', i.quantity,
        'price', i.unit_price
      )), '[]'::jsonb)
      FROM pos_sale_items i WHERE i.sale_id = q.sale_id
    )
  ) AS sale
  FROM qsales q
  LEFT JOIN pos_sellers sel ON sel.id = q.seller_id
  LEFT JOIN pos_stores st ON st.id = q.store_id
) x;
$function$;

GRANT EXECUTE ON FUNCTION public.campaign_run_periods() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaigns_overview_stats(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaigns_overview_conversions(date, date) TO authenticated, service_role;