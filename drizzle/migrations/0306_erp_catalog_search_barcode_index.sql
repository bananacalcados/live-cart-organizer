DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.erp_catalog_search(text,text[],integer,integer)'::regprocedure);
  IF position('pp.barcode=vars.gtin)' IN d) = 0 THEN RAISE EXCEPTION 'pattern not found'; END IF;
  d := replace(d, 'pp.barcode=vars.gtin)', 'pp.barcode=vars.gtin AND pp.barcode <> '''')');
  EXECUTE d;
END $do$;