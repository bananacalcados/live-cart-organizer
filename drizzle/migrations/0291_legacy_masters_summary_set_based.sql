CREATE OR REPLACE FUNCTION public.legacy_masters_summary(p_master_ids uuid[])
RETURNS TABLE(master_id uuid, variant_count integer, total_stock numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH st AS (SELECT id FROM public.pos_stores WHERE is_active AND NOT coalesce(is_simulation,false)),
  pb AS (SELECT pp.barcode, sum(pp.stock) s FROM public.pos_products pp JOIN st ON st.id=pp.store_id WHERE pp.barcode IS NOT NULL AND pp.barcode<>'' GROUP BY 1),
  pk AS (SELECT pp.sku, sum(pp.stock) s FROM public.pos_products pp JOIN st ON st.id=pp.store_id WHERE pp.sku IS NOT NULL AND pp.sku<>'' GROUP BY 1)
  SELECT v.master_id, count(*)::int AS variant_count,
    coalesce(sum(CASE WHEN v.gtin IS NOT NULL AND v.gtin<>'' THEN pb.s ELSE pk.s END),0) AS total_stock
  FROM public.product_variants v
  LEFT JOIN pb ON pb.barcode=v.gtin
  LEFT JOIN pk ON pk.sku=v.sku
  WHERE v.master_id=ANY(p_master_ids)
  GROUP BY v.master_id;
$function$;