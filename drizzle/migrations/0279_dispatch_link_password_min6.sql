CREATE OR REPLACE FUNCTION public.dispatch_link_hash_password(p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 6 OR length(p_password) > 128 THEN
    RAISE EXCEPTION 'senha_invalida';
  END IF;
  RETURN extensions.crypt(p_password, extensions.gen_salt('bf', 10));
END $$;
REVOKE EXECUTE ON FUNCTION public.dispatch_link_hash_password(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_link_hash_password(text) TO service_role;