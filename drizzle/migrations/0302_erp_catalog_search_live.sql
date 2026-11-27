INSERT INTO public.app_settings(key, value) VALUES ('product_source_live', '"shopify"'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.erp_catalog_search(p_query text DEFAULT NULL, p_ids text[] DEFAULT NULL, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q text := nullif(btrim(coalesce(p_query,'')),'');
  v_up text := upper(btrim(coalesce(p_query,'')));
  v_limit int := least(greatest(coalesce(p_limit,30),1),50);
  v_offset int := greatest(coalesce(p_offset,0),0);
  v_photos boolean;
  v_masters uuid[];
  v_color_filter jsonb := '{}'::jsonb; -- master_id -> cor (busca por código da live)
  v_variant_hit jsonb := '{}'::jsonb;  -- master_id -> variant_id (busca por código de variação)
  v_total bigint;
  v_items jsonb;
  c_perola constant uuid := '1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2';
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid,'admin') OR EXISTS (
      SELECT 1 FROM public.user_module_permissions WHERE user_id=v_uid AND module IN ('events','pos','inventory','expedition','marketing','chat'))) THEN
    RETURN jsonb_build_object('total',0,'items','[]'::jsonb);
  END IF;
  v_photos := public.can_view_product_photos();

  IF p_ids IS NOT NULL AND cardinality(p_ids) > 0 THEN
    SELECT array_agg(DISTINCT m.id) INTO v_masters FROM public.products_master m
    WHERE m.id::text = ANY(p_ids[1:200]) OR regexp_replace(coalesce(m.shopify_product_id,''),'\D','','g') = ANY(p_ids[1:200]);
  ELSIF v_q IS NOT NULL THEN
    -- 1) código da live (ex.: E019) -> produto + cor
    SELECT array_agg(c.master_id), jsonb_object_agg(c.master_id::text, c.color) INTO v_masters, v_color_filter
    FROM public.product_color_codes c WHERE c.code = v_up;
    -- 2) código de variação (etiqueta, GTIN, SKU, PDV)
    IF v_masters IS NULL THEN
      SELECT array_agg(x.master_id), jsonb_object_agg(x.master_id::text, x.vid) INTO v_masters, v_variant_hit FROM (
        SELECT DISTINCT ON (v.master_id) v.master_id, v.id vid FROM public.product_variants v
        WHERE v.id IN (
          SELECT pvc.variant_id FROM public.product_variant_codes pvc WHERE upper(pvc.code) = v_up
          UNION ALL SELECT v2.id FROM public.product_variants v2 WHERE v2.gtin = btrim(p_query)
          UNION ALL SELECT v3.id FROM public.product_variants v3 WHERE upper(v3.sku) = v_up AND v3.sku <> '')
        ORDER BY v.master_id) x;
    END IF;
    IF v_masters IS NULL THEN
      SELECT array_agg(DISTINCT m.id) INTO v_masters FROM public.pos_products p
      JOIN public.products_master m ON m.sku_root = p.parent_sku
      WHERE (p.barcode = btrim(p_query) AND p.barcode <> '') OR (upper(p.sku) = v_up AND p.sku <> '');
    END IF;
    IF v_masters IS NULL THEN
      SELECT array_agg(m.id) INTO v_masters FROM public.products_master m WHERE upper(m.sku_root) = v_up AND m.sku_root <> '';
    END IF;
    -- 3) nome (todas as palavras)
    IF v_masters IS NULL THEN
      SELECT array_agg(m.id) INTO v_masters FROM public.products_master m
      WHERE m.is_active AND NOT EXISTS (
        SELECT 1 FROM unnest(regexp_split_to_array(lower(v_q), '\s+')) w
        WHERE w <> '' AND position(w IN lower(unaccent_safe(m.name))) = 0 AND position(w IN lower(m.name)) = 0);
    END IF;
    IF v_masters IS NULL THEN RETURN jsonb_build_object('total',0,'items','[]'::jsonb); END IF;
  END IF;

  WITH base AS (
    SELECT m.id, m.name, m.description, m.category, m.brand, m.sale_price, m.shopify_product_id, m.created_at
    FROM public.products_master m
    WHERE (v_masters IS NULL AND m.is_active) OR m.id = ANY(v_masters)
  ), counted AS (SELECT count(*) n FROM base),
  page AS (SELECT * FROM base ORDER BY created_at DESC, id LIMIT v_limit OFFSET v_offset),
  vars AS (
    SELECT v.*, coalesce(nullif(v.sale_price_override,0), p.sale_price) price,
      coalesce((SELECT cc.color_key FROM public.product_color_codes cc WHERE cc.master_id=v.master_id AND lower(trim(cc.color))=lower(trim(v.color)) AND cc.color_key IS NOT NULL LIMIT 1), public.photo_color_slug(v.color)) ck,
      (SELECT cc.code FROM public.product_color_codes cc WHERE cc.master_id=v.master_id AND lower(trim(cc.color))=lower(trim(v.color)) LIMIT 1) live_code
    FROM public.product_variants v JOIN page p ON p.id=v.master_id
    WHERE v.is_active
      AND (NOT (v_color_filter ? v.master_id::text) OR lower(trim(v.color)) = lower(trim(v_color_filter->>v.master_id::text)))
  ), enriched AS (
    SELECT vars.*,
      CASE WHEN v_photos THEN (SELECT f.url_medium FROM public.product_color_photos f WHERE f.master_id=vars.master_id AND f.color_key IN (vars.ck,'geral') AND f.url_medium LIKE 'https://fotos.servidorbanana.com/%' ORDER BY (f.color_key=vars.ck) DESC, f.position, f.created_at LIMIT 1) END erp_img,
      (SELECT nullif(sm.image_url,'') FROM public.shopify_variant_mirror sm WHERE sm.shopify_variant_id = vars.shopify_variant_id) shop_img,
      (SELECT sum(pp.stock) FROM public.pos_products pp WHERE pp.store_id=c_perola AND ((vars.gtin <> '' AND pp.barcode=vars.gtin) OR (vars.sku <> '' AND pp.sku=vars.sku))) stock_perola
    FROM vars
  )
  SELECT (SELECT n FROM counted), coalesce(jsonb_agg(jsonb_build_object(
      'master_id', p.id, 'name', p.name, 'description', coalesce(p.description,''), 'category', p.category, 'brand', p.brand,
      'sale_price', p.sale_price, 'shopify_product_id', nullif(regexp_replace(coalesce(p.shopify_product_id,''),'\D','','g'),''),
      'hit_variant_id', v_variant_hit->>p.id::text,
      'variants', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'variant_id', e.id, 'sku', e.sku, 'gtin', e.gtin, 'color', e.color, 'size', e.size, 'price', e.price,
          'shopify_variant_id', nullif(regexp_replace(coalesce(e.shopify_variant_id,''),'\D','','g'),''),
          'live_code', e.live_code, 'image', coalesce(e.erp_img, e.shop_img), 'image_source', CASE WHEN e.erp_img IS NOT NULL THEN 'erp' WHEN e.shop_img IS NOT NULL THEN 'shopify' END,
          'stock_perola', coalesce(e.stock_perola,0))
        ORDER BY e.color, CASE WHEN e.size ~ '^\d+' THEN lpad(substring(e.size from '^\d+'),4,'0') ELSE 'z'||e.size END, e.size)
        FROM enriched e WHERE e.master_id=p.id), '[]'::jsonb)
    ) ORDER BY p.created_at DESC, p.id), '[]'::jsonb)
  INTO v_total, v_items FROM page p;

  RETURN jsonb_build_object('total', coalesce(v_total,0), 'items', v_items);
END $$;

REVOKE EXECUTE ON FUNCTION public.erp_catalog_search(text, text[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_catalog_search(text, text[], integer, integer) TO authenticated, service_role;