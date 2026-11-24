CREATE TABLE public.vps_reader_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
GRANT ALL ON public.vps_reader_keys TO service_role;
ALTER TABLE public.vps_reader_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vps_reader_allowed_ips (
  ip text PRIMARY KEY,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vps_reader_allowed_ips TO service_role;
ALTER TABLE public.vps_reader_allowed_ips ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vps_reader_guard (
  ip text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  calls integer NOT NULL DEFAULT 0,
  bad_window_start timestamptz NOT NULL DEFAULT now(),
  bad_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz
);
GRANT ALL ON public.vps_reader_guard TO service_role;
ALTER TABLE public.vps_reader_guard ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vps_reader_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  ip_headers jsonb,
  op text,
  table_name text,
  rows_returned integer,
  duration_ms integer,
  status text NOT NULL,
  key_id uuid
);
GRANT ALL ON public.vps_reader_audit TO service_role;
ALTER TABLE public.vps_reader_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX vps_reader_audit_created_idx ON public.vps_reader_audit(created_at);

-- Rate limit + bloqueio atômico. Única escrita: vps_reader_guard.
CREATE OR REPLACE FUNCTION public.vps_reader_guard_hit(p_ip text, p_bad boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.vps_reader_guard;
BEGIN
  INSERT INTO public.vps_reader_guard(ip) VALUES (left(p_ip,64)) ON CONFLICT (ip) DO NOTHING;
  SELECT * INTO g FROM public.vps_reader_guard WHERE ip = left(p_ip,64) FOR UPDATE;
  IF g.blocked_until IS NOT NULL AND g.blocked_until > now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'blocked');
  END IF;
  IF g.window_start < now() - interval '1 minute' THEN g.window_start := now(); g.calls := 0; END IF;
  IF g.bad_window_start < now() - interval '15 minutes' THEN g.bad_window_start := now(); g.bad_count := 0; END IF;
  g.calls := g.calls + 1;
  IF p_bad THEN g.bad_count := g.bad_count + 1; END IF;
  IF g.bad_count >= 5 THEN g.blocked_until := now() + interval '1 hour'; END IF;
  UPDATE public.vps_reader_guard SET window_start=g.window_start, calls=g.calls, bad_window_start=g.bad_window_start,
    bad_count=g.bad_count, blocked_until=g.blocked_until WHERE ip = g.ip;
  IF g.blocked_until IS NOT NULL AND g.blocked_until > now() THEN RETURN jsonb_build_object('allowed', false, 'reason', 'blocked'); END IF;
  IF g.calls > 120 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'rate'); END IF;
  RETURN jsonb_build_object('allowed', true);
END $$;
REVOKE ALL ON FUNCTION public.vps_reader_guard_hit(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vps_reader_guard_hit(text, boolean) TO service_role;

-- Auditoria sem dados lidos. Única escrita: vps_reader_audit (limpa >90 dias em lote pequeno).
CREATE OR REPLACE FUNCTION public.vps_reader_audit_log(p_ip text, p_ip_headers jsonb, p_op text, p_table text, p_rows integer, p_ms integer, p_status text, p_key_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.vps_reader_audit(ip, ip_headers, op, table_name, rows_returned, duration_ms, status, key_id)
  VALUES (left(p_ip,64), p_ip_headers, left(p_op,20), left(p_table,80), p_rows, p_ms, left(p_status,40), p_key_id);
  DELETE FROM public.vps_reader_audit WHERE id IN (SELECT id FROM public.vps_reader_audit WHERE created_at < now() - interval '90 days' ORDER BY id LIMIT 50);
END $$;
REVOKE ALL ON FUNCTION public.vps_reader_audit_log(text, jsonb, text, text, integer, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vps_reader_audit_log(text, jsonb, text, text, integer, integer, text, uuid) TO service_role;

INSERT INTO public.vps_reader_allowed_ips(ip, label) VALUES ('189.24.13.236', 'VPS nova') ON CONFLICT DO NOTHING;
INSERT INTO public.app_settings(key, value) SELECT 'vps_reader_enabled', 'false'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'vps_reader_enabled');