ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS shadow_reason text, ADD COLUMN IF NOT EXISTS shadow_at timestamptz;
CREATE OR REPLACE FUNCTION public.support_emergency_pause(p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Send failure: stop automatic sends (shadow) but keep triage running; a null-expiry AI pause silenced triage for 21h.
  UPDATE public.support_settings SET auto_reply_mode='shadow',
    shadow_reason=left(coalesce(nullif(p_reason,''),'erro_envio_nf_ou_correios'),500), shadow_at=now(), updated_at=now()
  WHERE auto_reply_mode IS DISTINCT FROM 'shadow';
END $function$;
UPDATE public.support_settings SET ai_pause_reason=NULL, ai_pause_until=NULL, auto_reply_mode='auto',
  shadow_reason='Falha de envio do assistente (Instagram @leidyfmarques) em 15/11 20:58', shadow_at='2026-11-15 23:58:03+00', updated_at=now()
WHERE ai_pause_reason LIKE 'Falha de envio do assistente%';