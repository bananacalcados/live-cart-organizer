CREATE OR REPLACE FUNCTION public.photo_color_slug(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN s ~ '^[a-z0-9][a-z0-9_-]{0,59}$' THEN s ELSE 'sem-cor' END
  FROM (SELECT regexp_replace(left(regexp_replace(regexp_replace(regexp_replace(
    lower(translate(coalesce(trim(p),''),
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ',
      'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY')),
    '[^a-z0-9_-]+','-','g'),'-+','-','g'),'^[-_]+',''),60),'-+$','') AS s) x
$$;
REVOKE ALL ON FUNCTION public.photo_color_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_color_slug(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_view_product_photos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(),'admin')
    OR (coalesce((SELECT value #>> '{}' FROM public.app_settings WHERE key='product_color_photos_mode'),'admin') = 'on'
        AND (public.has_module_access(auth.uid(),'inventory') OR public.has_module_access(auth.uid(),'pos') OR public.has_module_access(auth.uid(),'expedition'))))
  AND coalesce((SELECT value #>> '{}' FROM public.app_settings WHERE key='product_color_photos_mode'),'admin') <> 'off'
$$;
REVOKE ALL ON FUNCTION public.can_view_product_photos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_product_photos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_item_photos(p_keys text[])
RETURNS TABLE(key text, thumb text, medium text, full_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_product_photos() THEN RETURN; END IF;
  RETURN QUERY
  WITH k AS (SELECT DISTINCT trim(x) AS key FROM unnest(p_keys[1:200]) x WHERE coalesce(trim(x),'') <> ''),
  prod AS (
    SELECT DISTINCT ON (k.key) k.key, m.id AS master_id, p.color
    FROM k JOIN public.pos_products p ON (p.barcode = k.key OR p.sku = k.key)
    JOIN public.products_master m ON m.sku_root = p.parent_sku
    WHERE p.parent_sku IS NOT NULL AND p.parent_sku <> ''
    ORDER BY k.key, (p.barcode = k.key) DESC
  ),
  ck AS (
    SELECT prod.key, prod.master_id,
      coalesce((SELECT c.color_key FROM public.product_color_codes c
                WHERE c.master_id = prod.master_id AND lower(trim(c.color)) = lower(trim(prod.color))
                  AND c.color_key IS NOT NULL LIMIT 1),
               public.photo_color_slug(prod.color)) AS color_key
    FROM prod
  )
  SELECT ck.key, ph.url_thumb, ph.url_medium, ph.url_full
  FROM ck JOIN LATERAL (
    SELECT f.url_thumb, f.url_medium, f.url_full FROM public.product_color_photos f
    WHERE f.master_id = ck.master_id AND f.color_key IN (ck.color_key, 'geral')
      AND f.url_thumb LIKE 'https://fotos.servidorbanana.com/%'
    ORDER BY (f.color_key = ck.color_key) DESC, f.position, f.created_at
    LIMIT 1) ph ON true;
END $$;
REVOKE ALL ON FUNCTION public.pos_item_photos(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_item_photos(text[]) TO authenticated, service_role;