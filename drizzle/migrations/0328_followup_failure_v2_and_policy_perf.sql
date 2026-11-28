CREATE OR REPLACE FUNCTION public.live_followup_failure_v2(p_job_id uuid, p_reason text, p_uncertain boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE j live_followup_jobs;
BEGIN
  -- v2 (28/11/2026): incerto vira 'uncertain' (conferência manual, nunca reenvia) mas NÃO pausa a instância;
  -- pausa só por 3 erros seguidos ou bloqueio/desconexão do provedor, como no v1.
  SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id AND status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE live_followup_jobs SET status=CASE WHEN p_uncertain THEN 'uncertain' ELSE 'skipped' END,reason=left(p_reason,200) WHERE id=j.id;
  UPDATE live_followup_instances SET consecutive_errors=consecutive_errors+1,
    paused=paused OR consecutive_errors+1>=3 OR p_reason ~ '(disconnected|restrict|provider_429|provider_403)',
    reason=left(p_reason,200)
  WHERE whatsapp_number_id=j.whatsapp_number_id;
END $function$;
REVOKE ALL ON FUNCTION public.live_followup_failure_v2(uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_failure_v2(uuid,text,boolean) TO service_role;

DROP POLICY "Admins read heartbeats" ON public.queue_heartbeats;
CREATE POLICY "Admins read heartbeats" ON public.queue_heartbeats FOR SELECT TO authenticated USING ((select public.has_role((select auth.uid()),'admin'::app_role)));
DROP POLICY "Admins read alert settings" ON public.queue_alert_settings;
CREATE POLICY "Admins read alert settings" ON public.queue_alert_settings FOR SELECT TO authenticated USING ((select public.has_role((select auth.uid()),'admin'::app_role)));
DROP POLICY "Admins update alert settings" ON public.queue_alert_settings;
CREATE POLICY "Admins update alert settings" ON public.queue_alert_settings FOR UPDATE TO authenticated USING ((select public.has_role((select auth.uid()),'admin'::app_role))) WITH CHECK ((select public.has_role((select auth.uid()),'admin'::app_role)));
DROP POLICY "Admins read incidents" ON public.queue_alert_incidents;
CREATE POLICY "Admins read incidents" ON public.queue_alert_incidents FOR SELECT TO authenticated USING ((select public.has_role((select auth.uid()),'admin'::app_role)));