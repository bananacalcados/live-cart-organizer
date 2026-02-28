-- Update search_products_unaccent to include ALL products (even inactive/zero stock) for balance/exchange use
CREATE OR REPLACE FUNCTION public.search_products_unaccent(search_term text, p_store_id uuid)
 RETURNS SETOF pos_products
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM pos_products
  WHERE store_id = p_store_id
    AND (
      unaccent(name) ILIKE '%' || unaccent(search_term) || '%'
      OR sku ILIKE '%' || search_term || '%'
      OR barcode = search_term
    )
  ORDER BY name
  LIMIT 50;
$function$;