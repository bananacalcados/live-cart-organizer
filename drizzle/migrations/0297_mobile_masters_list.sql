CREATE OR REPLACE FUNCTION public.mobile_masters_list(p_term text DEFAULT NULL, p_active_only boolean DEFAULT false, p_in_stock boolean DEFAULT false, p_category_ids uuid[] DEFAULT NULL, p_limit int DEFAULT 30, p_offset int DEFAULT 0)
RETURNS TABLE(id uuid, name text, sku_root text, sale_price numeric, is_active boolean, variant_count int, color_count int, size_count int, total_stock numeric, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'inventory')) THEN RETURN; END IF;
  RETURN QUERY
  WITH st AS (SELECT s.id FROM public.pos_stores s WHERE s.is_active AND NOT coalesce(s.is_simulation,false)),
  pm AS (SELECT m.* FROM public.products_master m
    WHERE (NOT p_active_only OR m.is_active)
      AND (p_category_ids IS NULL OR cardinality(p_category_ids)=0 OR m.category_id = ANY(p_category_ids))
      AND (coalesce(btrim(p_term),'')='' OR m.name ILIKE '%'||btrim(p_term)||'%' OR m.sku_root ILIKE btrim(p_term)||'%')),
  pv AS (SELECT v.master_id, v.gtin, v.sku, v.color, v.size FROM public.product_variants v JOIN pm ON pm.id=v.master_id),
  pb AS (SELECT pp.barcode, sum(pp.stock) s FROM public.pos_products pp JOIN st ON st.id=pp.store_id WHERE pp.barcode IN (SELECT gtin FROM pv WHERE gtin<>'') GROUP BY 1),
  pk AS (SELECT pp.sku, sum(pp.stock) s FROM public.pos_products pp JOIN st ON st.id=pp.store_id WHERE pp.sku IN (SELECT pv.sku FROM pv WHERE pv.sku<>'') GROUP BY 1),
  agg AS (SELECT pv.master_id, count(*)::int vc, count(DISTINCT pv.color)::int cc, count(DISTINCT pv.size)::int sc,
      coalesce(sum(CASE WHEN pv.gtin IS NOT NULL AND pv.gtin<>'' THEN pb.s ELSE pk.s END),0) ts
    FROM pv LEFT JOIN pb ON pb.barcode=pv.gtin LEFT JOIN pk ON pk.sku=pv.sku GROUP BY 1),
  res AS (SELECT pm.id, pm.name, pm.sku_root, pm.sale_price, pm.is_active, coalesce(a.vc,0) vc, coalesce(a.cc,0) cc, coalesce(a.sc,0) sc, coalesce(a.ts,0) ts
    FROM pm LEFT JOIN agg a ON a.master_id=pm.id WHERE (NOT p_in_stock OR coalesce(a.ts,0)>0))
  SELECT r.id, r.name, r.sku_root, r.sale_price, r.is_active, r.vc, r.cc, r.sc, r.ts, count(*) OVER ()
  FROM res r ORDER BY r.name, r.id
  LIMIT least(greatest(coalesce(p_limit,30),1),100) OFFSET greatest(coalesce(p_offset,0),0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mobile_masters_list(text,boolean,boolean,uuid[],int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_masters_list(text,boolean,boolean,uuid[],int,int) TO authenticated, service_role;