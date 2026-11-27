CREATE OR REPLACE FUNCTION public._erp_fold(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT lower(translate(coalesce(p,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;
REVOKE EXECUTE ON FUNCTION public._erp_fold(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._erp_fold(text) TO authenticated, service_role;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.erp_catalog_search(text,text[],integer,integer)'::regprocedure);
  d := replace(d, 'WHERE w <> '''' AND position(w IN lower(unaccent_safe(m.name))) = 0 AND position(w IN lower(m.name)) = 0);',
                  'WHERE w <> '''' AND position(public._erp_fold(w) IN public._erp_fold(m.name)) = 0);');
  IF position('unaccent_safe' IN d) > 0 THEN RAISE EXCEPTION 'replace failed'; END IF;
  EXECUTE d;
END $do$;