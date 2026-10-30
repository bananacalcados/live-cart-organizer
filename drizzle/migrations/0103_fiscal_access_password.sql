CREATE TABLE public.fiscal_access_settings (
  area text PRIMARY KEY,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE TABLE public.fiscal_access_attempts (
  area text NOT NULL,
  user_key text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area, user_key)
);
GRANT ALL ON public.fiscal_access_settings TO service_role;
GRANT ALL ON public.fiscal_access_attempts TO service_role;
ALTER TABLE public.fiscal_access_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_access_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_area_password(p_area text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE h text; k text := coalesce(auth.uid()::text, 'anon'); a public.fiscal_access_attempts%ROWTYPE;
BEGIN
  IF p_area NOT IN ('fiscal','folha') THEN RETURN jsonb_build_object('ok',false,'error','area'); END IF;
  SELECT * INTO a FROM public.fiscal_access_attempts WHERE area=p_area AND user_key=k FOR UPDATE;
  IF FOUND AND a.locked_until IS NOT NULL AND a.locked_until > now() THEN
    RETURN jsonb_build_object('ok',false,'locked_until',a.locked_until);
  END IF;
  SELECT password_hash INTO h FROM public.fiscal_access_settings WHERE area=p_area;
  IF h IS NOT NULL AND p_password IS NOT NULL AND crypt(p_password, h) = h THEN
    DELETE FROM public.fiscal_access_attempts WHERE area=p_area AND user_key=k;
    RETURN jsonb_build_object('ok',true);
  END IF;
  INSERT INTO public.fiscal_access_attempts(area,user_key,failed_count) VALUES (p_area,k,1)
  ON CONFLICT (area,user_key) DO UPDATE SET
    failed_count = CASE WHEN fiscal_access_attempts.locked_until IS NOT NULL THEN 1 ELSE fiscal_access_attempts.failed_count + 1 END,
    locked_until = NULL, updated_at = now()
  RETURNING * INTO a;
  IF a.failed_count >= 5 THEN
    UPDATE public.fiscal_access_attempts SET locked_until = now() + interval '5 minutes' WHERE area=p_area AND user_key=k RETURNING * INTO a;
    RETURN jsonb_build_object('ok',false,'locked_until',a.locked_until);
  END IF;
  RETURN jsonb_build_object('ok',false,'remaining',5 - a.failed_count);
END $$;

CREATE OR REPLACE FUNCTION public.verify_fiscal_password(p_password text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((public.verify_area_password('fiscal', p_password)->>'ok')::boolean, false)
$$;

CREATE OR REPLACE FUNCTION public.change_area_password(p_area text, p_current text, p_new text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE h text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Apenas administradores podem alterar a senha'; END IF;
  IF p_area NOT IN ('fiscal','folha') THEN RAISE EXCEPTION 'Área inválida'; END IF;
  IF p_new IS NULL OR length(p_new) < 6 THEN RAISE EXCEPTION 'A nova senha precisa ter pelo menos 6 caracteres'; END IF;
  SELECT password_hash INTO h FROM public.fiscal_access_settings WHERE area=p_area FOR UPDATE;
  IF h IS NULL OR crypt(coalesce(p_current,''), h) <> h THEN RAISE EXCEPTION 'Senha atual incorreta'; END IF;
  UPDATE public.fiscal_access_settings SET password_hash = crypt(p_new, gen_salt('bf')), updated_at = now(), updated_by = auth.uid() WHERE area=p_area;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.verify_area_password(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_fiscal_password(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.change_area_password(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_area_password(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_fiscal_password(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_area_password(text,text,text) TO authenticated;