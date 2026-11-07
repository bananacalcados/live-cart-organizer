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
    SELECT pm.shopify_product_id, count(*) AS parent_count, min(pm.id) AS master_id
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

CREATE OR REPLACE FUNCTION public.import_shopify_missing_color(
  p_master_id uuid,
  p_shopify_product_id text,
  p_shopify_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_color_norm text := lower(public.unaccent(regexp_replace(btrim(p_shopify_color), '[[:space:]]+', ' ', 'g')));
  v_color text;
  v_existing_color text;
  v_code text;
  v_variant record;
  v_created integer := 0;
  v_parent_count integer;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Sem permissão para importar cores da Shopify';
  END IF;
  IF p_master_id IS NULL OR NULLIF(btrim(p_shopify_product_id), '') IS NULL OR v_color_norm = '' THEN
    RAISE EXCEPTION 'Produto e cor são obrigatórios';
  END IF;

  SELECT count(*) INTO v_parent_count
  FROM public.products_master
  WHERE shopify_product_id = p_shopify_product_id;
  IF v_parent_count <> 1 THEN
    RAISE EXCEPTION 'O produto da Shopify precisa estar vinculado a exatamente um cadastro do ERP';
  END IF;

  PERFORM 1 FROM public.products_master
  WHERE id = p_master_id AND shopify_product_id = p_shopify_product_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do ERP não encontrado, inativo ou com vínculo Shopify diferente';
  END IF;

  SELECT btrim(pv.color) INTO v_existing_color
  FROM public.product_variants pv
  WHERE pv.master_id = p_master_id
    AND lower(public.unaccent(regexp_replace(btrim(pv.color), '[[:space:]]+', ' ', 'g'))) = v_color_norm
  LIMIT 1;
  IF v_existing_color IS NOT NULL THEN
    v_code := public.ensure_product_color_code(p_master_id, v_existing_color);
    RETURN jsonb_build_object('already_exists', true, 'variants_created', 0, 'code', v_code, 'color', v_existing_color);
  END IF;

  SELECT min(btrim(s.option_color)) INTO v_color
  FROM public.shopify_variant_mirror s
  WHERE s.shopify_product_id = p_shopify_product_id AND s.product_status = 'ACTIVE'
    AND lower(public.unaccent(regexp_replace(btrim(s.option_color), '[[:space:]]+', ' ', 'g'))) = v_color_norm;
  IF v_color IS NULL THEN
    RAISE EXCEPTION 'A cor não existe mais entre as variações ativas do espelho Shopify';
  END IF;

  FOR v_variant IN
    SELECT s.*
    FROM public.shopify_variant_mirror s
    WHERE s.shopify_product_id = p_shopify_product_id AND s.product_status = 'ACTIVE'
      AND lower(public.unaccent(regexp_replace(btrim(s.option_color), '[[:space:]]+', ' ', 'g'))) = v_color_norm
    ORDER BY s.option_size, s.shopify_variant_id
  LOOP
    IF NULLIF(btrim(v_variant.sku), '') IS NULL OR NULLIF(btrim(v_variant.option_size), '') IS NULL THEN
      RAISE EXCEPTION 'Todas as variações precisam ter SKU e numeração na Shopify';
    END IF;
    IF v_variant.price IS NULL OR v_variant.price < 0 THEN
      RAISE EXCEPTION 'A variação % tem preço inválido', v_variant.sku;
    END IF;
    IF EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.sku = btrim(v_variant.sku)) THEN
      RAISE EXCEPTION 'O SKU % já existe no ERP', v_variant.sku;
    END IF;
    IF EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.shopify_variant_id = v_variant.shopify_variant_id) THEN
      RAISE EXCEPTION 'A variação Shopify % já está vinculada no ERP', v_variant.shopify_variant_id;
    END IF;
    IF NULLIF(btrim(v_variant.barcode), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.gtin = btrim(v_variant.barcode)) THEN
      RAISE EXCEPTION 'O código de barras % já existe no ERP', v_variant.barcode;
    END IF;

    INSERT INTO public.product_variants (
      master_id, sku, gtin, color, size, sale_price_override,
      initial_stock, is_active, shopify_variant_id, last_sync_source
    ) VALUES (
      p_master_id, btrim(v_variant.sku),
      COALESCE(NULLIF(btrim(v_variant.barcode), ''), public.gen_unique_ean13()),
      v_color, btrim(v_variant.option_size), v_variant.price,
      0, true, v_variant.shopify_variant_id, 'shopify_color_import'
    );
    v_created := v_created + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'sku', btrim(v_variant.sku), 'size', btrim(v_variant.option_size), 'price', v_variant.price
    ));
  END LOOP;

  v_code := public.ensure_product_color_code(p_master_id, v_color);
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'A cor foi importada, mas o código não pôde ser gerado';
  END IF;

  RETURN jsonb_build_object(
    'already_exists', false, 'variants_created', v_created,
    'code', v_code, 'color', v_color, 'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_shopify_missing_color(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_shopify_missing_color(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_shopify_missing_color(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_shopify_missing_color(uuid, text, text) TO service_role;