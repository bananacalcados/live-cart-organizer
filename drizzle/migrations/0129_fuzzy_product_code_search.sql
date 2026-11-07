CREATE OR REPLACE FUNCTION public.search_product_code_keys(p_query text, p_limit int DEFAULT 200)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH q AS (
    SELECT array_remove(regexp_split_to_array(lower(public.unaccent(coalesce(p_query,''))), '[^a-z0-9]+'), '') AS words,
           lower(public.unaccent(coalesce(p_query,''))) AS full_q
  ), c AS (
    SELECT v.code, lower(public.unaccent(concat_ws(' ', v.code, v.product_name, v.color, v.brand, v.category))) AS hay
    FROM v_product_color_codes v
  )
  SELECT c.code FROM c, q
  WHERE cardinality(q.words) > 0
    AND NOT EXISTS (
      SELECT 1 FROM unnest(q.words) w
      WHERE position(w in c.hay) = 0
        AND (length(w) < 4 OR public.word_similarity(w, c.hay) < 0.45)
    )
  ORDER BY public.word_similarity(q.full_q, c.hay) DESC, c.code
  LIMIT least(greatest(coalesce(p_limit,200),1),200);
$$;
REVOKE EXECUTE ON FUNCTION public.search_product_code_keys(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_product_code_keys(text,int) TO authenticated, service_role;