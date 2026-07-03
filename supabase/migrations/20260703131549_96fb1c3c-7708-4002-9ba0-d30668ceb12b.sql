
DROP FUNCTION IF EXISTS public.campaign_envios_detail(uuid);

CREATE OR REPLACE FUNCTION public.campaign_envios_detail(p_campanha_id uuid)
 RETURNS TABLE(envio_id uuid, phone text, nome text, status text, erro text, enviado_em timestamp with time zone, converteu boolean, valor numeric, comprou_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT ce.id, ce.phone, ce.cliente_id, ce.phone_suffix8, ce.status, ce.erro, ce.enviado_em,
         ce.enviado_em::date AS d
  FROM campanha_envios ce
  WHERE ce.campanha_id = p_campanha_id
),
conv AS (
  SELECT b.id AS envio_id,
         coalesce(sum(ps.total), 0) AS valor,
         count(DISTINCT ps.id) AS nsales,
         max(coalesce(ps.paid_at, ps.created_at)) AS comprou_em
  FROM base b
  JOIN pos_sales ps ON (
        (b.cliente_id IS NOT NULL AND ps.customer_unified_id = b.cliente_id)
     OR (b.phone_suffix8 IS NOT NULL
         AND right(regexp_replace(coalesce(ps.customer_phone, ''), '\D', '', 'g'), 8) = b.phone_suffix8)
  )
  WHERE b.status IN ('enviado','entregue','lido')
    AND ps.status IN ('completed','paid')
    AND coalesce(ps.paid_at, ps.created_at)::date >= b.d
    AND coalesce(ps.paid_at, ps.created_at)::date <= add_business_days(b.d, 7)
  GROUP BY b.id
)
SELECT b.id, b.phone, cv.name, b.status, b.erro, b.enviado_em,
       coalesce(c.nsales, 0) > 0 AS converteu,
       coalesce(c.valor, 0) AS valor,
       c.comprou_em
FROM base b
LEFT JOIN crm_customers_v cv ON cv.id = b.cliente_id
LEFT JOIN conv c ON c.envio_id = b.id
ORDER BY b.enviado_em DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_buyer_detail(p_envio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente_id uuid;
  v_suffix text;
  v_d date;
  v_result jsonb;
BEGIN
  SELECT ce.cliente_id, ce.phone_suffix8, ce.enviado_em::date
    INTO v_cliente_id, v_suffix, v_d
  FROM campanha_envios ce
  WHERE ce.id = p_envio_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH matched AS (
    SELECT ps.*
    FROM pos_sales ps
    WHERE (
          (v_cliente_id IS NOT NULL AND ps.customer_unified_id = v_cliente_id)
       OR (v_suffix IS NOT NULL
           AND right(regexp_replace(coalesce(ps.customer_phone, ''), '\D', '', 'g'), 8) = v_suffix)
    )
      AND ps.status IN ('completed','paid')
  ),
  conv_sales AS (
    SELECT * FROM matched
    WHERE coalesce(paid_at, created_at)::date >= v_d
      AND coalesce(paid_at, created_at)::date <= add_business_days(v_d, 7)
  ),
  first_conv AS (
    SELECT min(coalesce(paid_at, created_at)) AS min_dt FROM conv_sales
  )
  SELECT jsonb_build_object(
    'total_previous', (
      SELECT count(*) FROM matched m, first_conv f
      WHERE m.id NOT IN (SELECT id FROM conv_sales)
        AND coalesce(m.paid_at, m.created_at) < coalesce(f.min_dt, now())
    ),
    'total_lifetime', (SELECT count(*) FROM matched),
    'sales', (
      SELECT coalesce(jsonb_agg(sale ORDER BY (sale->>'date') DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', cs.id,
          'date', coalesce(cs.paid_at, cs.created_at),
          'total', cs.total,
          'subtotal', cs.subtotal,
          'discount', cs.discount,
          'payment_method', coalesce(nullif(cs.payment_method_detail, ''), cs.payment_method),
          'payment_gateway', cs.payment_gateway,
          'sale_type', cs.sale_type,
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
            FROM pos_sale_items i WHERE i.sale_id = cs.id
          )
        ) AS sale
        FROM conv_sales cs
        LEFT JOIN pos_sellers sel ON sel.id = cs.seller_id
        LEFT JOIN pos_stores st ON st.id = cs.store_id
      ) q
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.campaign_buyer_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_buyer_detail(uuid) TO service_role;
