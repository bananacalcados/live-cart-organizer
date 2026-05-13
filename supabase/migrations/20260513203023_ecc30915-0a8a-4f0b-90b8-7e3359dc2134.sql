
DROP VIEW IF EXISTS public.product_master_stock CASCADE;
DROP VIEW IF EXISTS public.product_variant_stock CASCADE;

CREATE VIEW public.product_variant_stock
WITH (security_invoker=on) AS
WITH matched AS (
  SELECT
    pp.id AS pos_id,
    pp.store_id,
    pp.stock,
    pp.image_url,
    pv.master_id,
    pv.id    AS variant_id,
    pv.color,
    pv.size,
    pv.sku,
    pv.gtin
  FROM pos_products pp
  CROSS JOIN LATERAL (
    SELECT v.id, v.master_id, v.color, v.size, v.sku, v.gtin
    FROM product_variants v
    WHERE
      (v.tiny_variant_id IS NOT NULL AND v.tiny_variant_id = pp.tiny_id::text)
      OR (pp.sku     IS NOT NULL AND v.sku  = pp.sku)
      OR (pp.barcode IS NOT NULL AND v.gtin = pp.barcode)
    ORDER BY
      (CASE WHEN v.tiny_variant_id = pp.tiny_id::text THEN 0
            WHEN v.sku  = pp.sku                       THEN 1
            WHEN v.gtin = pp.barcode                   THEN 2
            ELSE 9 END)
    LIMIT 1
  ) pv
)
SELECT
  m.master_id,
  m.variant_id,
  pm.name,
  m.color,
  m.size,
  m.sku,
  m.gtin AS barcode,
  max(m.image_url) AS image_url,
  COALESCE(sum(m.stock) FILTER (WHERE m.store_id = '4ade7b44-5043-4ab1-a124-7a6ab5468e29'), 0)::int AS store_centro,
  COALESCE(sum(m.stock) FILTER (WHERE m.store_id = '1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2'), 0)::int AS store_perola,
  COALESCE(sum(m.stock) FILTER (WHERE m.store_id = '2bd2c08d-321c-47ee-98a9-e27e936818ab'), 0)::int AS store_site,
  COALESCE(sum(m.stock) FILTER (WHERE m.store_id = '2a8c7db4-44b6-46e1-9963-7fee5b936e54'), 0)::int AS store_lojas_live,
  COALESCE(sum(m.stock) FILTER (WHERE m.store_id = '04408292-fc70-4f04-822b-349cbd4f6b09'), 0)::int AS store_site_centro,
  COALESCE(sum(m.stock), 0)::int AS total_stock
FROM matched m
JOIN products_master pm ON pm.id = m.master_id
GROUP BY m.master_id, m.variant_id, pm.name, m.color, m.size, m.sku, m.gtin;

CREATE VIEW public.product_master_stock
WITH (security_invoker=on) AS
SELECT
  master_id,
  name,
  count(DISTINCT variant_id)::int AS total_variants,
  sum(total_stock)::int           AS total_stock,
  sum(store_centro)::int          AS store_centro,
  sum(store_perola)::int          AS store_perola,
  sum(store_site)::int            AS store_site,
  sum(store_lojas_live)::int      AS store_lojas_live,
  sum(store_site_centro)::int     AS store_site_centro,
  count(DISTINCT variant_id) FILTER (WHERE total_stock > 0)::int AS variants_in_stock
FROM public.product_variant_stock
GROUP BY master_id, name;
