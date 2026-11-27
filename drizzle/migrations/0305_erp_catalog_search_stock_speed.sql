DO $do$
DECLARE d text; o text := '(SELECT sum(pp.stock) FROM public.pos_products pp WHERE pp.store_id=c_perola AND ((vars.gtin <> '''' AND pp.barcode=vars.gtin) OR (vars.sku <> '''' AND pp.sku=vars.sku))) stock_perola';
BEGIN
  d := pg_get_functiondef('public.erp_catalog_search(text,text[],integer,integer)'::regprocedure);
  IF position(o IN d) = 0 THEN RAISE EXCEPTION 'pattern not found'; END IF;
  d := replace(d, o, 'CASE WHEN coalesce(vars.gtin,'''') <> '''' AND EXISTS (SELECT 1 FROM public.pos_products pp WHERE pp.store_id=c_perola AND pp.barcode=vars.gtin)
        THEN (SELECT sum(pp.stock) FROM public.pos_products pp WHERE pp.store_id=c_perola AND pp.barcode=vars.gtin)
        ELSE (SELECT sum(pp.stock) FROM public.pos_products pp WHERE pp.store_id=c_perola AND pp.sku=vars.sku AND coalesce(vars.sku,'''') <> '''') END stock_perola');
  EXECUTE d;
END $do$;