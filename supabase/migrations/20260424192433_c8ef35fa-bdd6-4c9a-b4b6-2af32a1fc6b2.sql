-- RPCs to manage the meta_capi_internal_secret in Vault.
-- SECURITY DEFINER so they can write to vault schema.
-- Only callable by service_role (no GRANT to authenticated/anon).

CREATE OR REPLACE FUNCTION public.create_meta_capi_vault_secret(p_secret text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT vault.create_secret(p_secret, 'meta_capi_internal_secret', 'Meta CAPI internal auth secret for offline events') INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_meta_capi_vault_secret(p_id uuid, p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  PERFORM vault.update_secret(p_id, p_secret, 'meta_capi_internal_secret', 'Meta CAPI internal auth secret for offline events');
  RETURN true;
END;
$$;

-- Revoke from public, only service_role can call
REVOKE ALL ON FUNCTION public.create_meta_capi_vault_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_meta_capi_vault_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_meta_capi_vault_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_meta_capi_vault_secret(uuid, text) TO service_role;