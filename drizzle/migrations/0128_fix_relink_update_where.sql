DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.relink_products_from_shopify_mirror'::regproc);
  src := replace(src, 'update product_color_codes set shopify_ok = (shopify_status = ''ok'');',
    'update product_color_codes set shopify_ok = (shopify_status = ''ok'') where shopify_ok is distinct from (shopify_status = ''ok'');');
  EXECUTE src;
END $do$;
REVOKE EXECUTE ON FUNCTION public.relink_products_from_shopify_mirror() FROM PUBLIC, anon;