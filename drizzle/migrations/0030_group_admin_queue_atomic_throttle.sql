ALTER TABLE public.group_admin_throttle ADD COLUMN next_allowed_at timestamptz;
ALTER TABLE public.group_admin_actions ADD COLUMN last_attempt_at timestamptz, ADD COLUMN attempt_history timestamptz[] NOT NULL DEFAULT '{}';
UPDATE public.group_admin_actions SET last_attempt_at = started_at, attempt_history = ARRAY[started_at] WHERE started_at IS NOT NULL;
UPDATE public.group_admin_throttle SET next_allowed_at = last_action_at + make_interval(secs => max_gap_seconds) WHERE last_action_at IS NOT NULL;
CREATE INDEX idx_group_admin_attempt_time ON public.group_admin_actions(whatsapp_number_id, last_attempt_at) WHERE last_attempt_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.group_admin_attempt_counts(p_number_id uuid, p_now timestamptz DEFAULT now()) RETURNS TABLE(hour_count bigint, day_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
 SELECT count(*) FILTER (WHERE h.at > p_now - interval '1 hour'), count(*) FILTER (WHERE h.at >= date_trunc('day', p_now AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
 FROM public.group_admin_actions a CROSS JOIN LATERAL unnest(a.attempt_history) h(at)
 WHERE a.whatsapp_number_id = p_number_id AND a.last_attempt_at >= least(p_now - interval '1 hour', date_trunc('day', p_now AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo');
$$;
REVOKE ALL ON FUNCTION public.group_admin_attempt_counts(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_admin_attempt_counts(uuid,timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.group_admin_queue_counts(p_limit int DEFAULT 100, p_offset int DEFAULT 0) RETURNS TABLE(whatsapp_number_id uuid, hour_count bigint, day_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
 SELECT t.whatsapp_number_id,c.hour_count,c.day_count FROM (SELECT whatsapp_number_id FROM public.group_admin_throttle ORDER BY whatsapp_number_id LIMIT least(greatest(p_limit,1),200) OFFSET greatest(p_offset,0)) t
 CROSS JOIN LATERAL public.group_admin_attempt_counts(t.whatsapp_number_id) c;
$$;
REVOKE ALL ON FUNCTION public.group_admin_queue_counts(int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_admin_queue_counts(int,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_next_group_admin_action(p_number_id uuid)
RETURNS public.group_admin_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.group_admin_throttle; a public.group_admin_actions; v_now timestamptz := clock_timestamp(); v_time time; v_gap int; v_hour bigint; v_day bigint; v_provider text; v_active boolean;
BEGIN
 INSERT INTO public.group_admin_throttle(whatsapp_number_id) VALUES(p_number_id) ON CONFLICT DO NOTHING;
 SELECT * INTO t FROM public.group_admin_throttle WHERE whatsapp_number_id=p_number_id FOR UPDATE;
 v_now := clock_timestamp();
 SELECT is_active, provider INTO v_active,v_provider FROM public.whatsapp_numbers WHERE id=p_number_id;
 IF v_active IS DISTINCT FROM true THEN
   UPDATE public.group_admin_actions SET status='skipped', error_message='Instância inativa', finished_at=v_now, updated_at=v_now WHERE whatsapp_number_id=p_number_id AND status='queued';
   RETURN NULL;
 END IF;
 IF t.paused OR (t.next_allowed_at IS NOT NULL AND v_now < t.next_allowed_at) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.group_admin_actions WHERE whatsapp_number_id=p_number_id AND status='running' AND locked_until>v_now) THEN RETURN NULL; END IF;
 v_time := (v_now AT TIME ZONE 'America/Sao_Paulo')::time;
 IF NOT (CASE WHEN t.window_start<=t.window_end THEN v_time BETWEEN t.window_start AND t.window_end ELSE v_time>=t.window_start OR v_time<=t.window_end END) THEN RETURN NULL; END IF;
 SELECT hour_count,day_count INTO v_hour,v_day FROM public.group_admin_attempt_counts(p_number_id,v_now);
 IF v_hour>=t.max_per_hour OR v_day>=t.max_per_day THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.group_admin_actions WHERE whatsapp_number_id=p_number_id AND status='queued' AND (not_before IS NULL OR not_before<=v_now) ORDER BY created_at,seq NULLS LAST,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a.action_type='pin_message' AND EXISTS(SELECT 1 FROM public.group_campaign_block_dispatches WHERE whatsapp_number_id=p_number_id AND status IN ('pending','sending')) THEN
   UPDATE public.group_admin_actions SET not_before=v_now+interval '5 minutes',error_message='disparo de mensagem agendada em andamento',updated_at=v_now WHERE id=a.id;
   RETURN NULL;
 END IF;
 IF v_provider NOT IN ('uazapi','zapi','wasender') OR v_provider IS NULL OR (v_provider='wasender' AND a.action_type NOT IN ('set_only_admins_send','set_only_admins_add','promote_admin','demote_admin','add_participant','remove_participant')) THEN
   UPDATE public.group_admin_actions SET status='failed',error_message=format('Ação "%s" não suportada pelo provedor %s',a.action_type,coalesce(v_provider,'desconhecido')),finished_at=v_now,updated_at=v_now WHERE id=a.id;
   RETURN NULL;
 END IF;
 UPDATE public.group_admin_actions SET status='running',started_at=v_now,last_attempt_at=v_now,attempt_history=array_append(attempt_history,v_now),locked_until=v_now+interval '3 minutes',attempts=attempts+1,updated_at=v_now WHERE id=a.id RETURNING * INTO a;
 IF t.actions_since_long_pause+1 >= greatest(t.long_pause_every,1) THEN
   v_gap := t.long_pause_min_seconds+floor(random()*(greatest(t.long_pause_max_seconds-t.long_pause_min_seconds,0)+1))::int;
 ELSE
   v_gap := t.min_gap_seconds+floor(random()*(greatest(t.max_gap_seconds-t.min_gap_seconds,0)+1))::int;
 END IF;
 UPDATE public.group_admin_throttle SET last_action_at=v_now,next_allowed_at=v_now+make_interval(secs=>v_gap),actions_since_long_pause=CASE WHEN t.actions_since_long_pause+1>=greatest(t.long_pause_every,1) THEN 0 ELSE t.actions_since_long_pause+1 END WHERE whatsapp_number_id=p_number_id;
 RETURN a;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_group_admin_action(p_id uuid,p_outcome text,p_error text DEFAULT NULL,p_result jsonb DEFAULT NULL,p_instance_failure boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.group_admin_actions; t public.group_admin_throttle; v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_outcome NOT IN ('done','failed','retry') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
 SELECT * INTO a FROM public.group_admin_actions WHERE id=p_id;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO t FROM public.group_admin_throttle WHERE whatsapp_number_id=a.whatsapp_number_id FOR UPDATE;
 SELECT * INTO a FROM public.group_admin_actions WHERE id=p_id FOR UPDATE;
 IF a.status<>'running' THEN RETURN; END IF;
 UPDATE public.group_admin_actions SET status=CASE WHEN p_outcome='retry' THEN 'queued' ELSE p_outcome END,not_before=CASE WHEN p_outcome='retry' THEN v_now+interval '10 minutes' ELSE not_before END,finished_at=CASE WHEN p_outcome='retry' THEN NULL ELSE v_now END,locked_until=NULL,error_message=p_error,result=p_result,updated_at=v_now WHERE id=p_id;
 UPDATE public.group_admin_throttle SET next_allowed_at=greatest(next_allowed_at,v_now+coalesce(next_allowed_at-last_action_at,interval '0 seconds')),
 consecutive_failures=CASE WHEN p_outcome='done' THEN 0 WHEN p_instance_failure THEN consecutive_failures+1 ELSE consecutive_failures END,
 paused=CASE WHEN p_outcome<>'done' AND p_instance_failure AND consecutive_failures+1>=3 THEN true ELSE paused END,
 paused_reason=CASE WHEN p_outcome<>'done' AND p_instance_failure AND consecutive_failures+1>=3 THEN '3 falhas seguidas: '||left(coalesce(p_error,'erro desconhecido'),180) ELSE paused_reason END
 WHERE whatsapp_number_id=a.whatsapp_number_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_group_admin_action(uuid,text,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_group_admin_action(uuid,text,text,jsonb,boolean) TO service_role;