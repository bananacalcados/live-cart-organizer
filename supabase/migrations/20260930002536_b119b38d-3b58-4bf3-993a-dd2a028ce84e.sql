CREATE TABLE public.meta_ads_token_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  current_token_secret_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (id, token_expires_at, last_refreshed_at, last_error, updated_at) ON public.meta_ads_token_state TO authenticated;
GRANT ALL ON public.meta_ads_token_state TO service_role;
ALTER TABLE public.meta_ads_token_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Logged users read token state" ON public.meta_ads_token_state FOR SELECT TO authenticated USING (true);
INSERT INTO public.meta_ads_token_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.meta_ads_get_token()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT ds.decrypted_secret FROM public.meta_ads_token_state s
  JOIN vault.decrypted_secrets ds ON ds.id = s.current_token_secret_id WHERE s.id = 1
$$;

CREATE OR REPLACE FUNCTION public.meta_ads_set_token(p_token text, p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_id uuid;
BEGIN
  SELECT current_token_secret_id INTO v_id FROM public.meta_ads_token_state WHERE id = 1;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_token, 'meta_ads_access_token_refreshed');
  ELSE
    PERFORM vault.update_secret(v_id, p_token);
  END IF;
  INSERT INTO public.meta_ads_token_state (id, current_token_secret_id, token_expires_at, last_refreshed_at, last_error, updated_at)
  VALUES (1, v_id, p_expires_at, now(), NULL, now())
  ON CONFLICT (id) DO UPDATE SET current_token_secret_id = v_id, token_expires_at = p_expires_at,
    last_refreshed_at = now(), last_error = NULL, updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.meta_ads_get_token() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_ads_set_token(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ads_get_token() TO service_role;
GRANT EXECUTE ON FUNCTION public.meta_ads_set_token(text, timestamptz) TO service_role;