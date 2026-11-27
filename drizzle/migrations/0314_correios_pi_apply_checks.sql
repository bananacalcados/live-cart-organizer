CREATE FUNCTION public.correios_pi_apply_checks(p_updates jsonb) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE changed integer;
BEGIN
 IF jsonb_typeof(p_updates) <> 'array' OR jsonb_array_length(p_updates)>50 THEN RAISE EXCEPTION 'Invalid check batch'; END IF;
 WITH patches AS (SELECT * FROM jsonb_to_recordset(p_updates) AS x(id uuid,expected_status text,expected_checked_at timestamptz,status text,protocolo text,last_status_payload jsonb,resposta_texto text,answered_at timestamptz,last_checked_at timestamptz,error_message text))
 UPDATE public.correios_pi_requests r SET status=p.status,protocolo=coalesce(p.protocolo,r.protocolo),last_status_payload=p.last_status_payload,resposta_texto=coalesce(p.resposta_texto,r.resposta_texto),answered_at=coalesce(p.answered_at,r.answered_at),last_checked_at=p.last_checked_at,error_message=p.error_message
 FROM patches p WHERE r.id=p.id AND r.status=p.expected_status AND r.last_checked_at IS NOT DISTINCT FROM p.expected_checked_at
 AND (r.last_checked_at,r.last_status_payload,r.error_message) IS DISTINCT FROM (p.last_checked_at,p.last_status_payload,p.error_message);
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.correios_pi_apply_checks(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.correios_pi_apply_checks(jsonb) TO service_role;