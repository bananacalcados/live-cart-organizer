CREATE OR REPLACE FUNCTION public.get_meta_capi_vault_state()
RETURNS TABLE(id uuid, value text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.decrypted_secret::text
  FROM vault.decrypted_secrets s
  WHERE s.name = 'meta_capi_internal_secret'
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_meta_capi_vault_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_capi_vault_state() TO service_role;