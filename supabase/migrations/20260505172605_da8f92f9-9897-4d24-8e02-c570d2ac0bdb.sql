
-- 1. Atualiza RPC para usar vendedora mais frequente (desempate: venda mais recente)
CREATE OR REPLACE FUNCTION public.get_customer_store_seller_map()
 RETURNS TABLE(customer_phone text, store_id uuid, store_name text, seller_id uuid, seller_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sales_keyed AS (
    SELECT
      right(regexp_replace(pc.whatsapp, '[^0-9]', '', 'g'), 8) AS phone_key,
      s.store_id,
      s.seller_id,
      s.created_at
    FROM pos_sales s
    JOIN pos_customers pc ON pc.id = s.customer_id
    WHERE s.customer_id IS NOT NULL
      AND pc.whatsapp IS NOT NULL
      AND pc.whatsapp != ''
      AND s.status IN ('completed','paid')
  ),
  store_freq AS (
    SELECT phone_key, store_id, count(*) AS c, max(created_at) AS last_at
    FROM sales_keyed
    WHERE store_id IS NOT NULL
    GROUP BY phone_key, store_id
  ),
  seller_freq AS (
    SELECT phone_key, seller_id, count(*) AS c, max(created_at) AS last_at
    FROM sales_keyed
    WHERE seller_id IS NOT NULL
    GROUP BY phone_key, seller_id
  ),
  top_store AS (
    SELECT DISTINCT ON (phone_key) phone_key, store_id
    FROM store_freq
    ORDER BY phone_key, c DESC, last_at DESC
  ),
  top_seller AS (
    SELECT DISTINCT ON (phone_key) phone_key, seller_id
    FROM seller_freq
    ORDER BY phone_key, c DESC, last_at DESC
  )
  SELECT
    COALESCE(ts.phone_key, tse.phone_key) AS customer_phone,
    ts.store_id,
    st.name AS store_name,
    tse.seller_id,
    sel.name AS seller_name
  FROM top_store ts
  FULL OUTER JOIN top_seller tse ON tse.phone_key = ts.phone_key
  LEFT JOIN pos_stores st ON st.id = ts.store_id
  LEFT JOIN pos_sellers sel ON sel.id = tse.seller_id;
$function$;
