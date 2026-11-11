CREATE OR REPLACE FUNCTION public.support_ai_settings_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object('enabled', ai_enabled, 'triage_model', ai_triage_model, 'agent_model', ai_agent_model,
    'max_calls', ai_max_calls_per_conversation_day, 'max_offer_attempts', max_offer_attempts,
    'is_admin', public.has_role(auth.uid(),'admin'),
    'calls_7d', (SELECT count(*) FROM public.support_ai_calls WHERE created_at > now() - interval '7 days'),
    'failures_7d', (SELECT count(*) FROM public.support_ai_calls WHERE created_at > now() - interval '7 days' AND NOT ok))
  INTO r FROM public.support_settings LIMIT 1;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_settings_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ai_settings_get() TO authenticated;