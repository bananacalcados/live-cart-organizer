ALTER TABLE public.live_followup_settings ADD COLUMN IF NOT EXISTS sender text NOT NULL DEFAULT 'v1';
ALTER TABLE public.live_followup_settings DROP CONSTRAINT IF EXISTS live_followup_settings_sender_check;
ALTER TABLE public.live_followup_settings ADD CONSTRAINT live_followup_settings_sender_check CHECK (sender IN ('v1','v2'));
COMMENT ON COLUMN public.live_followup_settings.sender IS 'Interruptor do enviador: v1 = lote antigo, v2 = uma mensagem por instância. Voltar para v1 desfaz na hora.';

CREATE TABLE public.queue_heartbeats(
  worker text PRIMARY KEY,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_duration_ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.queue_heartbeats TO authenticated;
GRANT ALL ON public.queue_heartbeats TO service_role;
ALTER TABLE public.queue_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read heartbeats" ON public.queue_heartbeats FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.queue_alert_settings(
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  alert_phone text CHECK (alert_phone IS NULL OR alert_phone ~ '^55[1-9][0-9]{9,10}$'),
  overdue_minutes integer NOT NULL DEFAULT 10 CHECK (overdue_minutes BETWEEN 2 AND 240),
  heartbeat_minutes integer NOT NULL DEFAULT 5 CHECK (heartbeat_minutes BETWEEN 2 AND 120),
  renotify_minutes integer NOT NULL DEFAULT 30 CHECK (renotify_minutes BETWEEN 10 AND 720),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, UPDATE ON public.queue_alert_settings TO authenticated;
GRANT ALL ON public.queue_alert_settings TO service_role;
ALTER TABLE public.queue_alert_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read alert settings" ON public.queue_alert_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Admins update alert settings" ON public.queue_alert_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
INSERT INTO public.queue_alert_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.queue_alert_incidents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  last_notified_at timestamptz,
  notify_count integer NOT NULL DEFAULT 0,
  closed_notified boolean NOT NULL DEFAULT false,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_send_error text
);
CREATE UNIQUE INDEX queue_alert_incidents_one_open ON public.queue_alert_incidents((true)) WHERE closed_at IS NULL;
CREATE INDEX queue_alert_incidents_recent ON public.queue_alert_incidents(opened_at DESC);
GRANT SELECT ON public.queue_alert_incidents TO authenticated;
GRANT ALL ON public.queue_alert_incidents TO service_role;
ALTER TABLE public.queue_alert_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read incidents" ON public.queue_alert_incidents FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.queue_heartbeat(p_worker text, p_ok boolean, p_error text DEFAULT NULL, p_ms integer DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO queue_heartbeats(worker,last_run_at,last_ok_at,last_error,last_duration_ms,updated_at)
  VALUES (left(p_worker,80),now(),CASE WHEN p_ok THEN now() END,CASE WHEN p_ok THEN NULL ELSE left(p_error,200) END,p_ms,now())
  ON CONFLICT (worker) DO UPDATE SET last_run_at=now(),
    last_ok_at=CASE WHEN p_ok THEN now() ELSE queue_heartbeats.last_ok_at END,
    last_error=CASE WHEN p_ok THEN NULL ELSE left(p_error,200) END,
    last_duration_ms=p_ms,updated_at=now();
$$;
REVOKE ALL ON FUNCTION public.queue_heartbeat(text,boolean,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_heartbeat(text,boolean,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_health(p_overdue_minutes integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s queue_alert_settings; m integer; cut timestamptz; r jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM queue_alert_settings WHERE id;
  m := greatest(1, least(coalesce(p_overdue_minutes, s.overdue_minutes, 10), 1440));
  cut := now() - make_interval(mins => m);
  SELECT jsonb_build_object(
    'generated_at', now(),
    'overdue_minutes', m,
    'heartbeat_minutes', coalesce(s.heartbeat_minutes,5),
    'followup_enabled', coalesce((SELECT (value->>'enabled')::boolean FROM live_followup_settings WHERE id),false),
    'followup_sender', (SELECT sender FROM live_followup_settings WHERE id),
    'queues', jsonb_build_array(
      (SELECT jsonb_build_object('queue','live_followup_jobs','alarm',true,
         'overdue',count(*),'oldest_due_at',min(scheduled_at),
         'by_instance',coalesce((SELECT jsonb_agg(jsonb_build_object('instance',x.whatsapp_number_id,'overdue',x.c,'oldest_due_at',x.o)) FROM (SELECT whatsapp_number_id,count(*) c,min(scheduled_at) o FROM live_followup_jobs WHERE status='pending' AND scheduled_at<cut GROUP BY 1) x),'[]'::jsonb),
         'stuck_processing',(SELECT count(*) FROM live_followup_jobs WHERE status='processing' AND claimed_at<now()-interval '5 minutes'),
         'uncertain',(SELECT count(*) FROM live_followup_jobs WHERE status='uncertain'))
       FROM live_followup_jobs WHERE status='pending' AND scheduled_at<cut),
      (SELECT jsonb_build_object('queue','selfservice_message_queue','alarm',true,
         'overdue',count(*),'oldest_due_at',min(next_attempt_at),
         'by_instance',coalesce((SELECT jsonb_agg(jsonb_build_object('instance',x.whatsapp_number_id,'overdue',x.c,'oldest_due_at',x.o)) FROM (SELECT whatsapp_number_id,count(*) c,min(next_attempt_at) o FROM selfservice_message_queue WHERE status='pending' AND next_attempt_at<cut GROUP BY 1) x),'[]'::jsonb),
         'stuck_processing',(SELECT count(*) FROM selfservice_message_queue WHERE status IN ('sending','claimed') AND sent_at IS NULL AND claimed_at<now()-interval '5 minutes'))
       FROM selfservice_message_queue WHERE status='pending' AND next_attempt_at<cut),
      (SELECT jsonb_build_object('queue','support_outbox','alarm',true,'overdue',count(*),'oldest_due_at',min(coalesce(available_at,created_at)))
       FROM support_outbox WHERE status='pending' AND coalesce(available_at,created_at)<cut AND created_at>now()-interval '24 hours'),
      (SELECT jsonb_build_object('queue','automation_message_queue','alarm',true,'overdue',count(*),'oldest_due_at',min(scheduled_at))
       FROM automation_message_queue WHERE status='pending' AND scheduled_at<cut AND created_at>now()-interval '24 hours'),
      (SELECT jsonb_build_object('queue','meta_message_queue','alarm',false,'overdue',count(*),'oldest_due_at',min(scheduled_at))
       FROM meta_message_queue WHERE status='pending' AND scheduled_at<cut)
    ),
    'heartbeats', coalesce((SELECT jsonb_agg(jsonb_build_object('worker',worker,'last_run_at',last_run_at,'last_ok_at',last_ok_at,'last_error',last_error,'last_duration_ms',last_duration_ms)) FROM queue_heartbeats),'[]'::jsonb),
    'instances', coalesce((SELECT jsonb_agg(jsonb_build_object('instance',whatsapp_number_id,'paused',paused,'consecutive_errors',consecutive_errors,'reason',reason)) FROM live_followup_instances WHERE paused OR consecutive_errors>=2),'[]'::jsonb),
    'open_incident', (SELECT jsonb_build_object('opened_at',opened_at,'last_notified_at',last_notified_at,'notify_count',notify_count,'summary',summary) FROM queue_alert_incidents WHERE closed_at IS NULL)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.queue_health(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_health(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.live_followup_due_instances()
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE live_followup_jobs SET status='skipped',reason='no_instance' WHERE status='pending' AND scheduled_at<=now() AND whatsapp_number_id IS NULL;
  RETURN QUERY SELECT DISTINCT whatsapp_number_id FROM live_followup_jobs WHERE status='pending' AND scheduled_at<=now() AND whatsapp_number_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_due_instances() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_due_instances() TO service_role;

CREATE OR REPLACE FUNCTION public.live_followup_claim_one(p_number_id uuid)
 RETURNS SETOF live_followup_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j live_followup_jobs; cfg jsonb; pacing live_followup_instances; v_hour integer; v_day integer; v_min integer; v_max integer; chosen integer; used integer[];
BEGIN
-- v2 (28/11/2026): reserva UMA mensagem da instancia pedida; 'uncertain' nao segura a instancia (fica para conferencia).
-- NAO REMOVER (25/11/2026): envio preso em 'processing'/'uncertain' travava a fila inteira do numero (21/11 a 25/11).
UPDATE live_followup_jobs SET status='skipped', reason='processing_expirado' WHERE status='processing' AND claimed_at < now() - interval '10 minutes';
UPDATE live_followup_jobs SET status='skipped', reason='uncertain_expirado' WHERE status='uncertain' AND coalesce(claimed_at, created_at) < now() - interval '60 minutes';
UPDATE live_followup_jobs SET reason='toque_expirado' WHERE type='F' AND step=0 AND status='sent' AND reason='aguardando_toque' AND button_expires_at<=now(); SELECT value INTO cfg FROM live_followup_settings WHERE id; IF NOT coalesce((cfg->>'enabled')::boolean,false) THEN UPDATE live_followup_jobs SET status='cancelled',reason='global_disabled' WHERE status='pending'; RETURN; END IF;
FOR j IN SELECT * FROM live_followup_jobs WHERE status='pending' AND scheduled_at<=now() AND whatsapp_number_id=p_number_id ORDER BY public.live_followup_priority(type,step),scheduled_at,id LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
IF NOT public.live_followup_enabled(j.event_id) THEN UPDATE live_followup_jobs SET status='cancelled',reason='event_disabled' WHERE id=j.id; CONTINUE; END IF;
INSERT INTO live_followup_instances(whatsapp_number_id) VALUES(j.whatsapp_number_id) ON CONFLICT DO NOTHING;
SELECT * INTO pacing FROM live_followup_instances WHERE whatsapp_number_id=j.whatsapp_number_id FOR UPDATE;
IF pacing.paused OR pacing.next_send_at>now() THEN RETURN; END IF;
IF EXISTS(SELECT 1 FROM live_followup_jobs WHERE whatsapp_number_id=j.whatsapp_number_id AND status='processing') THEN RETURN; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(j.customer_key,72819));
SELECT count(*) INTO v_hour FROM live_followup_jobs WHERE whatsapp_number_id=j.whatsapp_number_id AND claimed_at>now()-interval '1 hour'; IF v_hour>=coalesce((cfg->'limits'->>'hourly')::integer,80) THEN RETURN; END IF;
SELECT count(*) INTO v_day FROM live_followup_jobs WHERE customer_key=j.customer_key AND claimed_at>=((now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo'); IF v_day>=coalesce((cfg->'limits'->>'daily_customer')::integer,6) THEN UPDATE live_followup_jobs SET status='skipped',reason='customer_daily_limit' WHERE id=j.id; CONTINUE; END IF;
IF j.type='D' AND now()>j.scheduled_at+interval '15 minutes' THEN UPDATE live_followup_jobs SET status='skipped',reason='late_step' WHERE id=j.id; CONTINUE; END IF;
IF j.step>0 AND EXISTS(SELECT 1 FROM live_followup_jobs WHERE sequence_key=j.sequence_key AND step<j.step AND status IN ('pending','processing','uncertain')) THEN CONTINUE; END IF;
SELECT array_agg(variant) INTO used FROM live_followup_jobs WHERE customer_key=j.customer_key AND type=j.type AND step=j.step AND variant IS NOT NULL AND status IN ('sent','processing','uncertain'); SELECT x INTO chosen FROM generate_series(0,2) x WHERE NOT x=ANY(coalesce(used,'{}'::integer[])) ORDER BY random() LIMIT 1;
IF chosen IS NULL THEN UPDATE live_followup_jobs SET status='skipped',reason='variations_exhausted' WHERE id=j.id; CONTINUE; END IF;
v_min:=coalesce((cfg->'limits'->>'interval_min')::integer,20);v_max:=coalesce((cfg->'limits'->>'interval_max')::integer,60);
UPDATE live_followup_instances SET next_send_at=clock_timestamp()+make_interval(secs=>v_min+floor(random()*(v_max-v_min+1))::integer) WHERE whatsapp_number_id=j.whatsapp_number_id;
UPDATE live_followup_jobs SET status='processing',claimed_at=clock_timestamp(),variant=chosen WHERE id=j.id RETURNING * INTO j; RETURN NEXT j; RETURN;
END LOOP; END $function$;
REVOKE ALL ON FUNCTION public.live_followup_claim_one(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_claim_one(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.live_followup_job_context(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT jsonb_build_object('global_enabled',public.live_followup_enabled(NULL),'type_enabled',coalesce((cfg.value->'types'->j.type->>'enabled')::boolean,false),'event',jsonb_build_object('id',e.id,'live_followup_enabled',e.live_followup_enabled,'whatsapp_number_id',(public.live_event_sender(e.id)->>'id')::uuid,'wa_initial_number_id',e.wa_initial_number_id,'self_service_slug',e.self_service_slug),'order',CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'stage',o.stage,'is_paid',o.is_paid,'paid_externally',o.paid_externally,'registered_at',o.registered_at,'products',o.products,'merged_into_order_id',o.merged_into_order_id,'selfservice_cart_sent_at',coalesce(o.selfservice_cart_sent_at,o.live_followup_cart_sent_at),'cart_link',o.cart_link) END,'access',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('registered_at',a.registered_at,'whatsapp_confirmed_at',a.whatsapp_confirmed_at,'form_draft',a.form_draft) END,'registration',jsonb_build_object('full_name',r.full_name),'customer',jsonb_build_object('full_name',c.full_name),'number',jsonb_build_object('provider',n.provider,'is_active',n.is_active,'is_online',n.is_online),'instance',jsonb_build_object('last_message',i.last_message),'has_phone',greatest(length(regexp_replace(coalesce(r.whatsapp,''),'\D','','g')),length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g')),length(regexp_replace(coalesce(a.confirmed_phone,a.entered_phone,''),'\D','','g')))>=10,'linked_closed',EXISTS(SELECT 1 FROM orders linked WHERE linked.id=ANY(a.order_ids) AND (linked.is_paid OR linked.paid_externally OR linked.stage IN ('cancelled','refunded'))),'initial_sent_at',(SELECT sent_at FROM live_followup_jobs WHERE sequence_key=j.sequence_key AND step=0 AND status='sent' LIMIT 1),'cart_sent_at',coalesce(q.sent_at,o.live_followup_cart_sent_at),
 'replied_since_previous',EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.phone = ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,l.ig_user_id)) AND m.direction='incoming' AND m.whatsapp_number_id=j.whatsapp_number_id AND m.created_at>greatest(j.base_at,coalesce(prev.sent_at,q.sent_at,o.live_followup_cart_sent_at,j.base_at)) AND coalesce(m.source,'')<>'ig_interaction' AND NOT EXISTS(SELECT 1 FROM live_selfservice_accesses sa WHERE sa.confirm_message_id=m.id) AND (j.channel<>'instagram' OR (coalesce(m.message,'') NOT LIKE '💬 Comentário%' AND NOT EXISTS(SELECT 1 FROM live_comments lc WHERE lc.comment_id=m.message_id)))),
 'previous_sent_at',coalesce(prev.sent_at,q.sent_at,o.live_followup_cart_sent_at),
 'customer_replied',EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.phone = ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,l.ig_user_id)) AND m.direction='incoming' AND m.whatsapp_number_id=j.whatsapp_number_id AND m.created_at>j.base_at AND coalesce(m.source,'')<>'ig_interaction' AND (j.channel<>'instagram' OR (coalesce(m.message,'') NOT LIKE '💬 Comentário%' AND NOT EXISTS(SELECT 1 FROM live_comments lc WHERE lc.comment_id=m.message_id)))),
 'manual_recent',EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.phone = ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,l.ig_user_id)) AND m.whatsapp_number_id=j.whatsapp_number_id AND m.direction='outgoing' AND m.sender_user_id IS NOT NULL AND m.created_at>now()-interval '10 minutes'),
 'opted_out',EXISTS(SELECT 1 FROM automation_opt_outs b WHERE b.phone_key=automation_phone_key(j.phone)) OR EXISTS(SELECT 1 FROM blocked_contacts b WHERE b.phone IN (j.phone,substring(j.phone from 3),substring(j.phone from 1 for 4)||substring(j.phone from 6))) OR EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.phone = ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,l.ig_user_id)) AND m.direction='incoming' AND m.created_at>j.base_at AND lower(trim(m.message)) IN ('parar','sair','não quero','nao quero')),
 'instagram_context',CASE WHEN j.channel='instagram' THEN public.instagram_reply_context(j.instagram,j.event_id,j.whatsapp_number_id) ELSE NULL END,'window_open',EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.phone = ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,l.ig_user_id)) AND m.direction='incoming' AND m.whatsapp_number_id=j.whatsapp_number_id AND m.created_at>now()-interval '24 hours' AND (j.channel<>'instagram' OR (coalesce(m.message,'') NOT LIKE '💬 Comentário%' AND NOT EXISTS(SELECT 1 FROM live_comments lc WHERE lc.comment_id=m.message_id)))))
 FROM live_followup_jobs j JOIN events e ON e.id=j.event_id LEFT JOIN live_followup_settings cfg ON cfg.id
 LEFT JOIN orders o ON o.id=j.order_id LEFT JOIN live_selfservice_accesses a ON a.id=j.access_id LEFT JOIN customer_registrations r ON r.order_id=o.id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN whatsapp_numbers n ON n.id=j.whatsapp_number_id LEFT JOIN live_followup_instances i ON i.whatsapp_number_id=j.whatsapp_number_id
 LEFT JOIN instagram_user_links l ON lower(l.username)=j.instagram
 LEFT JOIN LATERAL (SELECT max(sent_at) sent_at FROM live_followup_jobs WHERE sequence_key=j.sequence_key AND step<j.step AND status='sent') prev ON true
 LEFT JOIN LATERAL (SELECT sent_at FROM selfservice_message_queue WHERE order_id=o.id AND kind='cart_link' AND status='sent' ORDER BY sent_at LIMIT 1) q ON true
 WHERE j.id=p_job_id
$function$;