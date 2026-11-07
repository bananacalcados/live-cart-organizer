CREATE OR REPLACE FUNCTION public.shopify_missing_colors(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  master_id uuid,
  shopify_product_id text,
  product_name text,
  shopify_color text,
  variants jsonb,
  possible_erp_colors text[],
  kind text,
  synced_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar o relatório de cores';
  END IF;

  RETURN QUERY
  WITH parent_links AS (
    SELECT pm.shopify_product_id, count(*) AS parent_count, min(pm.id::text)::uuid AS master_id
    FROM public.products_master pm
    WHERE NULLIF(btrim(pm.shopify_product_id), '') IS NOT NULL
    GROUP BY pm.shopify_product_id
  ),
  source AS (
    SELECT pl.master_id, s.shopify_product_id, s.product_title, s.shopify_variant_id,
      s.option_color, s.option_size, s.sku, s.barcode, s.price, s.synced_at,
      lower(public.unaccent(regexp_replace(btrim(s.option_color), '[[:space:]]+', ' ', 'g'))) AS color_norm
    FROM public.shopify_variant_mirror s
    JOIN parent_links pl ON pl.shopify_product_id = s.shopify_product_id AND pl.parent_count = 1
    WHERE s.product_status = 'ACTIVE' AND NULLIF(btrim(s.option_color), '') IS NOT NULL
  ),
  erp_colors AS (
    SELECT DISTINCT pv.master_id, btrim(pv.color) AS color,
      lower(public.unaccent(regexp_replace(btrim(pv.color), '[[:space:]]+', ' ', 'g'))) AS color_norm
    FROM public.product_variants pv
    WHERE NULLIF(btrim(pv.color), '') IS NOT NULL
  ),
  missing AS (
    SELECT s.*
    FROM source s
    WHERE NOT EXISTS (
      SELECT 1 FROM erp_colors e
      WHERE e.master_id = s.master_id AND e.color_norm = s.color_norm
    )
  ),
  grouped AS (
    SELECT m.master_id, m.shopify_product_id, max(m.product_title) AS product_name,
      min(m.option_color) AS shopify_color, m.color_norm,
      jsonb_agg(jsonb_build_object(
        'shopify_variant_id', m.shopify_variant_id,
        'sku', m.sku,
        'size', m.option_size,
        'price', m.price,
        'barcode', m.barcode
      ) ORDER BY m.option_size, m.shopify_variant_id) AS variants,
      max(m.synced_at) AS synced_at
    FROM missing m
    GROUP BY m.master_id, m.shopify_product_id, m.color_norm
  ),
  classified AS (
    SELECT g.*, COALESCE(near.candidates, ARRAY[]::text[]) AS possible_erp_colors
    FROM grouped g
    LEFT JOIN LATERAL (
      SELECT array_agg(x.color ORDER BY x.score DESC, x.color) AS candidates
      FROM (
        SELECT e.color, public.similarity(e.color_norm, g.color_norm) AS score
        FROM erp_colors e
        WHERE e.master_id = g.master_id AND e.color_norm <> g.color_norm
          AND public.similarity(e.color_norm, g.color_norm) >= 0.55
        ORDER BY score DESC, e.color
        LIMIT 5
      ) x
    ) near ON true
  ),
  filtered AS (
    SELECT c.*
    FROM classified c
    WHERE NULLIF(btrim(p_search), '') IS NULL OR (
      public.unaccent(lower(c.product_name || ' ' || c.shopify_color || ' ' || c.variants::text))
      LIKE '%' || public.unaccent(lower(btrim(p_search))) || '%'
    )
  )
  SELECT f.master_id, f.shopify_product_id, f.product_name, f.shopify_color,
    f.variants, f.possible_erp_colors,
    CASE WHEN cardinality(f.possible_erp_colors) > 0 THEN 'spelling' ELSE 'missing' END AS kind,
    f.synced_at, count(*) OVER() AS total_count
  FROM filtered f
  ORDER BY f.product_name, f.shopify_color
  LIMIT LEAST(200, GREATEST(1, COALESCE(p_limit, 50)))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_missing_colors(integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shopify_missing_colors(integer, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.shopify_missing_colors(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shopify_missing_colors(integer, integer, text) TO service_role;