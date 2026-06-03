ALTER FUNCTION public.gen_unique_ean13() SECURITY DEFINER;
ALTER FUNCTION public.gen_unique_variant_sku(text) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.gen_unique_ean13() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gen_unique_variant_sku(text) TO authenticated, service_role;