ALTER TABLE public.webhook_signature_state
  ADD COLUMN IF NOT EXISTS total_missing integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_no_secret integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observe_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_result text;

CREATE OR REPLACE FUNCTION public.record_webhook_auth(p_provider text, p_result text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.webhook_signature_state;
BEGIN
  INSERT INTO public.webhook_signature_state(provider, observe_started_at) VALUES (p_provider, now()) ON CONFLICT DO NOTHING;
  IF p_result = 'no_secret' THEN
    UPDATE public.webhook_signature_state SET total_no_secret = total_no_secret + 1, last_result = p_result, updated_at = now()
      WHERE provider = p_provider RETURNING * INTO r;
    RETURN false;
  ELSIF p_result = 'valid' THEN
    UPDATE public.webhook_signature_state SET consecutive_valid = consecutive_valid + 1, total_valid = total_valid + 1,
      last_valid_at = now(), last_result = p_result, updated_at = now(),
      observe_started_at = coalesce(observe_started_at, now())
      WHERE provider = p_provider RETURNING * INTO r;
    IF NOT r.enforced AND r.consecutive_valid >= 20 AND now() - r.observe_started_at >= interval '1 hour' THEN
      UPDATE public.webhook_signature_state SET enforced = true, enforced_at = now() WHERE provider = p_provider;
      INSERT INTO public.security_events(event, details)
        VALUES ('signature_enforcement_enabled', jsonb_build_object('provider', p_provider, 'consecutive_valid', r.consecutive_valid));
      RETURN true;
    END IF;
    RETURN r.enforced;
  ELSE
    SELECT * INTO r FROM public.webhook_signature_state WHERE provider = p_provider;
    UPDATE public.webhook_signature_state SET consecutive_valid = 0,
      total_invalid = total_invalid + CASE WHEN p_result = 'invalid' THEN 1 ELSE 0 END,
      total_missing = total_missing + CASE WHEN p_result = 'missing' THEN 1 ELSE 0 END,
      last_invalid_at = now(), last_result = p_result, updated_at = now(),
      observe_started_at = coalesce(observe_started_at, now())
      WHERE provider = p_provider;
    IF r.last_invalid_at IS NULL OR r.last_invalid_at < now() - interval '10 minutes' THEN
      INSERT INTO public.security_events(event, details)
        VALUES ('webhook_auth_invalid', jsonb_build_object('provider', p_provider, 'result', p_result, 'enforced', r.enforced));
    END IF;
    RETURN coalesce(r.enforced, false);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_webhook_auth(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_auth(text, text) TO service_role;