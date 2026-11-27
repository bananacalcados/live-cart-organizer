ALTER TABLE public.event_catalog_products ADD COLUMN IF NOT EXISTS erp_master_id uuid;
ALTER TABLE public.event_crossell_offers ADD COLUMN IF NOT EXISTS erp_master_id uuid;
ALTER TABLE public.order_crossell_items ADD COLUMN IF NOT EXISTS erp_variant_id uuid, ADD COLUMN IF NOT EXISTS sku text;
CREATE INDEX IF NOT EXISTS event_catalog_products_erp_idx ON public.event_catalog_products (event_id, erp_master_id) WHERE erp_master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_crossell_offers_erp_idx ON public.event_crossell_offers (event_id, erp_master_id) WHERE erp_master_id IS NOT NULL;

INSERT INTO public.app_settings (key, value) VALUES ('product_source_crossell', '"shopify"'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.erp_catalog_public_items(p_master_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH m AS (
    SELECT id, name, sale_price, shopify_product_id FROM public.products_master
    WHERE id = ANY(p_master_ids[1:50])
  ), v AS (
    SELECT v.id, v.master_id, v.sku, v.gtin, v.color, v.size, v.shopify_variant_id,
      coalesce(nullif(v.sale_price_override,0), m.sale_price) price,
      coalesce((SELECT cc.color_key FROM public.product_color_codes cc WHERE cc.master_id=v.master_id AND lower(trim(cc.color))=lower(trim(v.color)) AND cc.color_key IS NOT NULL LIMIT 1), public.photo_color_slug(v.color)) ck
    FROM public.product_variants v JOIN m ON m.id = v.master_id WHERE v.is_active
  ), e AS (
    SELECT v.*,
      (SELECT f.url_medium FROM public.product_color_photos f WHERE f.master_id=v.master_id AND f.color_key IN (v.ck,'geral') AND f.url_medium LIKE 'https://fotos.servidorbanana.com/%' ORDER BY (f.color_key=v.ck) DESC, f.position, f.created_at LIMIT 1) erp_img,
      (SELECT nullif(sm.image_url,'') FROM public.shopify_variant_mirror sm WHERE sm.shopify_variant_id = v.shopify_variant_id) shop_img,
      CASE WHEN coalesce(v.gtin,'') <> ''
        THEN EXISTS (SELECT 1 FROM public.pos_products pp WHERE pp.store_id='1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2' AND pp.barcode=v.gtin AND pp.stock > 0)
        ELSE EXISTS (SELECT 1 FROM public.pos_products pp WHERE pp.store_id='1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2' AND pp.sku=v.sku AND coalesce(v.sku,'') <> '' AND pp.stock > 0) END in_stock
    FROM v
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'master_id', m.id, 'name', m.name, 'sale_price', m.sale_price, 'shopify_product_id', m.shopify_product_id,
    'variants', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'variant_id', e.id, 'sku', coalesce(nullif(e.gtin,''), e.sku), 'color', e.color, 'size', e.size, 'price', e.price,
        'shopify_variant_id', e.shopify_variant_id, 'image', coalesce(e.erp_img, e.shop_img), 'in_stock', e.in_stock)
        ORDER BY e.color, e.size) FROM e WHERE e.master_id = m.id), '[]'::jsonb))), '[]'::jsonb)
  FROM m;
$f$;
REVOKE ALL ON FUNCTION public.erp_catalog_public_items(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_catalog_public_items(uuid[]) TO service_role;

DO $do$
DECLARE d text;
  procedure_patch text[][] := ARRAY[
    ARRAY['it jsonb; out_items jsonb', 'mid uuid; it jsonb; out_items jsonb'],
    ARRAY['promo := null; cat := null;', 'if coalesce(it->>''shopify_product_id'','''') ~* ''^erp'' then pid := ''''; end if;
    if coalesce(it->>''shopify_variant_id'','''') ~* ''^erp'' then vid := ''''; end if;
    mid := case when coalesce(it->>''erp_master_id'','''') ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then (it->>''erp_master_id'')::uuid end;
    promo := null; cat := null;'],
    ARRAY['regexp_replace(shopify_product_id,''\D'','''',''g'') = pid and is_active', '(regexp_replace(shopify_product_id,''\D'','''',''g'') = pid or (mid is not null and erp_master_id = mid)) and is_active'],
    ARRAY['where p.event_id = p_event_id and regexp_replace(coalesce(m.shopify_product_id,''''),''\D'','''',''g'') = pid', 'where p.event_id = p_event_id and ((pid <> '''' and regexp_replace(coalesce(m.shopify_product_id,''''),''\D'','''',''g'') = pid) or m.id = mid)'],
    ARRAY['and pid = any(shopify_product_ids) limit 1', 'and (pid = any(shopify_product_ids) or (mid is not null and (''erp:''||mid::text) = any(shopify_product_ids))) limit 1']
  ];
  i int;
BEGIN
  d := pg_get_functiondef('public.compute_live_order_conditions(uuid,text,text,jsonb)'::regprocedure);
  FOR i IN 1..array_length(procedure_patch,1) LOOP
    IF position(procedure_patch[i][1] IN d) = 0 THEN RAISE EXCEPTION 'pattern % not found', i; END IF;
    d := replace(d, procedure_patch[i][1], procedure_patch[i][2]);
  END LOOP;
  EXECUTE d;
END $do$;