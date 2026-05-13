
-- ============================================================
-- ETAPA 4: Views unificadas de estoque
-- ============================================================

DROP VIEW IF EXISTS public.product_variant_stock CASCADE;
DROP VIEW IF EXISTS public.product_master_stock CASCADE;

-- View principal: estoque por variante × loja
CREATE VIEW public.product_variant_stock
WITH (security_invoker=on) AS
WITH matched AS (
  SELECT
    pv.master_id,
    pv.id        AS variant_id,
    pv.color,
    pv.size,
    pv.sku,
    pv.gtin,
    pp.store_id,
    pp.stock,
    pp.image_url,
    pp.price     AS pos_price,
    pp.cost_price AS pos_cost
  FROM product_variants pv
  JOIN pos_products pp
    ON  (pv.tiny_variant_id IS NOT NULL AND pv.tiny_variant_id = pp.tiny_id::text)
     OR (pv.tiny_variant_id IS NULL AND pv.sku IS NOT NULL AND pv.sku = pp.sku)
     OR (pv.tiny_variant_id IS NULL AND pv.sku IS NULL AND pv.gtin IS NOT NULL AND pv.gtin = pp.barcode)
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

-- View resumo: total por produto pai
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

-- Índices auxiliares para acelerar o match
CREATE INDEX IF NOT EXISTS idx_pos_products_tiny_id ON public.pos_products(tiny_id);
CREATE INDEX IF NOT EXISTS idx_pos_products_sku    ON public.pos_products(sku);
CREATE INDEX IF NOT EXISTS idx_pos_products_barcode ON public.pos_products(barcode);
CREATE INDEX IF NOT EXISTS idx_product_variants_tiny ON public.product_variants(tiny_variant_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku  ON public.product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_gtin ON public.product_variants(gtin);
