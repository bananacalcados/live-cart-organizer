CREATE TABLE public.dispatch_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  password_hash text NOT NULL,
  password_version integer NOT NULL DEFAULT 1,
  allowed_instance_ids uuid[] NOT NULL,
  template_mode text NOT NULL DEFAULT 'all_approved' CHECK (template_mode IN ('all_approved','list')),
  allowed_templates jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_audiences jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_comm_types text[],
  allow_send_now boolean NOT NULL DEFAULT true,
  allow_schedule boolean NOT NULL DEFAULT false,
  max_recipients integer NOT NULL CHECK (max_recipients > 0 AND max_recipients <= 50000),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  simulate_only boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dispatch_links TO authenticated;
GRANT ALL ON public.dispatch_links TO service_role;
ALTER TABLE public.dispatch_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispatch links" ON public.dispatch_links FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
REVOKE SELECT (password_hash) ON public.dispatch_links FROM authenticated;

CREATE TABLE public.dispatch_link_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.dispatch_links(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  password_version integer NOT NULL,
  ip text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_link_sessions_link ON public.dispatch_link_sessions(link_id);
GRANT SELECT ON public.dispatch_link_sessions TO authenticated;
GRANT ALL ON public.dispatch_link_sessions TO service_role;
ALTER TABLE public.dispatch_link_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispatch link sessions" ON public.dispatch_link_sessions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
REVOKE SELECT (token_hash) ON public.dispatch_link_sessions FROM authenticated;

CREATE TABLE public.dispatch_link_attempts (
  id bigserial PRIMARY KEY,
  link_id uuid REFERENCES public.dispatch_links(id) ON DELETE CASCADE,
  ip text,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_link_attempts_link_time ON public.dispatch_link_attempts(link_id, created_at DESC);
GRANT SELECT ON public.dispatch_link_attempts TO authenticated;
GRANT ALL ON public.dispatch_link_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dispatch_link_attempts_id_seq TO service_role;
ALTER TABLE public.dispatch_link_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispatch link attempts" ON public.dispatch_link_attempts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.dispatch_link_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.dispatch_links(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.dispatch_link_sessions(id) ON DELETE CASCADE,
  config_hash text NOT NULL,
  phone_masked text,
  status text NOT NULL CHECK (status IN ('sent','failed','simulated')),
  message_id text,
  error text,
  used_at timestamptz,
  used_dispatch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_link_tests_session ON public.dispatch_link_tests(session_id, created_at DESC);
GRANT SELECT ON public.dispatch_link_tests TO authenticated;
GRANT ALL ON public.dispatch_link_tests TO service_role;
ALTER TABLE public.dispatch_link_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispatch link tests" ON public.dispatch_link_tests FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

ALTER TABLE public.dispatch_history ADD COLUMN dispatch_link_id uuid REFERENCES public.dispatch_links(id) ON DELETE SET NULL;
CREATE INDEX idx_dispatch_history_link ON public.dispatch_history(dispatch_link_id, created_at DESC) WHERE dispatch_link_id IS NOT NULL;

-- Senha: hash bcrypt (só servidor)
CREATE OR REPLACE FUNCTION public.dispatch_link_hash_password(p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 8 OR length(p_password) > 128 THEN
    RAISE EXCEPTION 'senha_invalida';
  END IF;
  RETURN extensions.crypt(p_password, extensions.gen_salt('bf', 10));
END $$;

-- Login atômico com bloqueio: 5 erros/15 min por link+IP, 20 erros/15 min por link
CREATE OR REPLACE FUNCTION public.dispatch_link_login(p_code text, p_password text, p_ip text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  l public.dispatch_links%ROWTYPE;
  v_ip_fail int; v_link_fail int; v_sid uuid; v_exp timestamptz;
BEGIN
  SELECT * INTO l FROM public.dispatch_links WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    -- não diferencia de senha errada
    PERFORM extensions.crypt(coalesce(p_password,''), extensions.gen_salt('bf', 10));
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  SELECT count(*) FILTER (WHERE ip IS NOT DISTINCT FROM p_ip), count(*)
    INTO v_ip_fail, v_link_fail
    FROM public.dispatch_link_attempts
   WHERE link_id = l.id AND success = false AND created_at > now() - interval '15 minutes';
  IF v_ip_fail >= 5 OR v_link_fail >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'locked');
  END IF;
  IF l.password_hash <> extensions.crypt(coalesce(p_password,''), l.password_hash) THEN
    INSERT INTO public.dispatch_link_attempts(link_id, ip, success) VALUES (l.id, p_ip, false);
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF NOT l.is_active OR l.revoked_at IS NOT NULL OR (l.expires_at IS NOT NULL AND l.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  INSERT INTO public.dispatch_link_attempts(link_id, ip, success) VALUES (l.id, p_ip, true);
  v_exp := now() + interval '2 hours';
  INSERT INTO public.dispatch_link_sessions(link_id, token_hash, password_version, ip, expires_at)
  VALUES (l.id, p_token_hash, l.password_version, p_ip, v_exp) RETURNING id INTO v_sid;
  RETURN jsonb_build_object('ok', true, 'session_id', v_sid, 'expires_at', v_exp, 'link_name', l.name);
END $$;

-- Telefones que já receberam o modelo hoje (fuso de São Paulo) pela instância
CREATE OR REPLACE FUNCTION public.dispatch_link_sent_today(p_template text, p_instance uuid)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT regexp_replace(r.phone, '\D', '', 'g')
    FROM public.dispatch_history h
    JOIN public.dispatch_recipients r ON r.dispatch_id = h.id AND r.status = 'sent'
   WHERE h.template_name = p_template
     AND h.whatsapp_number_id = p_instance
     AND h.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
$$;

REVOKE ALL ON FUNCTION public.dispatch_link_hash_password(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_link_login(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_link_sent_today(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_link_hash_password(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_link_login(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_link_sent_today(text, uuid) TO service_role;