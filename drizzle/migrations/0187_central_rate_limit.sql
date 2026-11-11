CREATE TABLE public.central_rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.central_rate_limits TO service_role;
ALTER TABLE public.central_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX central_rate_limits_updated_idx ON public.central_rate_limits(updated_at);
COMMENT ON TABLE public.central_rate_limits IS 'Contadores de tentativas das Centrais públicas (chaves já em hash: ip:<sha256>, tk:<sha256>). Service-only.';

-- p_fail=false: registra uma tentativa e diz se pode seguir. p_fail=true: registra tentativa inválida e bloqueia ao exceder.
CREATE OR REPLACE FUNCTION public.central_rate_guard(p_keys text[], p_fail boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; r record; max_attempts int; max_fail int; allowed boolean := true;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce(cardinality(p_keys),0) < 1 OR cardinality(p_keys) > 3 THEN RETURN false; END IF;
  FOREACH k IN ARRAY (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_keys) x) LOOP
    IF k !~ '^(ip|tk):[0-9a-f]{64}$' THEN RETURN false; END IF;
    max_attempts := CASE WHEN left(k,3)='ip:' THEN 60 ELSE 30 END;  -- por janela de 10 min
    max_fail     := CASE WHEN left(k,3)='ip:' THEN 10 ELSE 5 END;
    INSERT INTO central_rate_limits(bucket) VALUES (k) ON CONFLICT (bucket) DO NOTHING;
    SELECT * INTO r FROM central_rate_limits WHERE bucket=k FOR UPDATE;
    IF r.window_start < now() - interval '10 minutes' THEN
      UPDATE central_rate_limits SET window_start=now(), attempts=0, failures=0, updated_at=now() WHERE bucket=k;
      r.attempts := 0; r.failures := 0;
    END IF;
    IF r.blocked_until IS NOT NULL AND r.blocked_until > now() THEN allowed := false; CONTINUE; END IF;
    IF p_fail THEN
      UPDATE central_rate_limits SET failures=r.failures+1, updated_at=now(),
        blocked_until = CASE WHEN r.failures+1 >= max_fail THEN now() + interval '30 minutes' ELSE blocked_until END
      WHERE bucket=k;
      IF r.failures+1 >= max_fail THEN allowed := false; END IF;
    ELSE
      UPDATE central_rate_limits SET attempts=r.attempts+1, updated_at=now(),
        blocked_until = CASE WHEN r.attempts+1 > max_attempts THEN now() + interval '30 minutes' ELSE blocked_until END
      WHERE bucket=k;
      IF r.attempts+1 > max_attempts THEN allowed := false; END IF;
    END IF;
  END LOOP;
  -- limpeza automática, pequena e ocasional (sem cron novo)
  IF random() < 0.05 THEN
    DELETE FROM central_rate_limits WHERE bucket IN (
      SELECT bucket FROM central_rate_limits
      WHERE updated_at < now() - interval '1 day' AND (blocked_until IS NULL OR blocked_until < now())
      ORDER BY updated_at LIMIT 500);
  END IF;
  RETURN allowed;
END $$;
REVOKE ALL ON FUNCTION public.central_rate_guard(text[],boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.central_rate_guard(text[],boolean) TO service_role;