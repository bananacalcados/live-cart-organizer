CREATE OR REPLACE FUNCTION public.rh_public_hit(p_ip text, p_code text, p_action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_ip int := 0; n_code int := 0; n_codes_ip int := 0; n_act_code int := 0;
BEGIN
  IF p_action NOT IN ('open','draft','submit') THEN RETURN false; END IF;
  -- Linhas antigas sem 'action' são ignoradas (ficam só como auditoria).
  IF p_action IN ('open','submit') AND p_ip IS NOT NULL THEN
    SELECT count(*), count(DISTINCT details->>'code') INTO n_ip, n_codes_ip FROM security_events
     WHERE event = 'rh_public' AND ip = p_ip AND created_at > now() - interval '1 hour' AND details->>'action' = p_action;
    IF n_ip >= 60 THEN RETURN false; END IF;
    IF p_action = 'open' AND n_codes_ip >= 15 AND NOT EXISTS (
      SELECT 1 FROM security_events WHERE event='rh_public' AND ip = p_ip AND created_at > now() - interval '1 hour'
        AND details->>'action'='open' AND details->>'code' = p_code) THEN RETURN false; END IF;
  END IF;
  IF p_action = 'submit' THEN
    SELECT count(*) INTO n_act_code FROM security_events WHERE event='rh_public' AND details->>'code' = p_code
      AND created_at > now() - interval '1 hour' AND details->>'action'='submit';
    IF n_act_code >= 20 THEN RETURN false; END IF;
  ELSE
    SELECT count(*), count(*) FILTER (WHERE details->>'action' = p_action) INTO n_code, n_act_code FROM security_events
     WHERE event='rh_public' AND details->>'code' = p_code AND created_at > now() - interval '1 hour' AND details ? 'action';
    IF n_code >= 600 THEN RETURN false; END IF;
    IF p_action = 'draft' AND n_act_code >= 400 THEN RETURN false; END IF;
  END IF;
  INSERT INTO security_events(event, ip, details) VALUES ('rh_public', p_ip, jsonb_build_object('code', p_code, 'action', p_action));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.rh_public_hit(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_public_hit(text,text,text) TO service_role;
COMMENT ON FUNCTION public.rh_public_hit(text,text) IS 'DEPRECATED: replaced by rh_public_hit(text,text,text)';