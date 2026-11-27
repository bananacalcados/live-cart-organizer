DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.erp_catalog_search(text,text[],integer,integer)'::regprocedure);
  d := replace(d, 'WITH base AS (', 'v_color_filter := coalesce(v_color_filter, ''{}''::jsonb); v_variant_hit := coalesce(v_variant_hit, ''{}''::jsonb);
  WITH base AS (');
  IF position('v_color_filter := coalesce' IN d) = 0 THEN RAISE EXCEPTION 'replace failed'; END IF;
  EXECUTE d;
END $do$;