-- lovable-cron-fallback-reviewed: Minute crash recovery is required; wake on enqueue and unschedule after queue drain, never a permanent sweeper.
ALTER TABLE public.selfservice_instance_pacing ADD COLUMN IF NOT EXISTS next_send_at timestamptz;
ALTER TABLE public.selfservice_instance_pacing ADD COLUMN IF NOT EXISTS delay_ms integer;
CREATE INDEX IF NOT EXISTS selfservice_queue_lease_idx ON public.selfservice_message_queue (claimed_at) WHERE status IN ('sending','claimed') AND sent_at IS NULL;
CREATE INDEX IF NOT EXISTS selfservice_queue_instance_order_idx ON public.selfservice_message_queue (whatsapp_number_id, created_at, id) WHERE status IN ('pending','sending','claimed');
CREATE OR REPLACE FUNCTION public.selfservice_instance_gate(p_number_id text, p_min_ms integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t timestamptz := clock_timestamp(); d integer := 3000 + floor(random()*4001)::integer; ok boolean;
BEGIN
 INSERT INTO public.selfservice_instance_pacing(whatsapp_number_id,last_sent_at,next_send_at,delay_ms)
 VALUES(coalesce(p_number_id,'sem-instancia'),t,t+make_interval(secs=>d/1000.0),d)
 ON CONFLICT(whatsapp_number_id) DO UPDATE SET last_sent_at=t,next_send_at=t+make_interval(secs=>d/1000.0),delay_ms=d
 WHERE coalesce(selfservice_instance_pacing.next_send_at,selfservice_instance_pacing.last_sent_at+interval '7 seconds') <= t
 RETURNING true INTO ok;
 RETURN coalesce(ok,false);
END $$;
CREATE OR REPLACE FUNCTION public.selfservice_queue_backstop_refresh()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('selfservice-queue-backstop',0));
 SELECT jobid INTO j FROM cron.job WHERE jobname='selfservice-message-queue-backstop';
 IF EXISTS(SELECT 1 FROM public.selfservice_message_queue WHERE status IN ('pending','sending','claimed') AND sent_at IS NULL LIMIT 1) THEN
   IF j IS NULL THEN
     PERFORM cron.schedule('selfservice-message-queue-backstop','* * * * *','SELECT public.selfservice_queue_backstop_tick();');
   END IF;
 ELSIF j IS NOT NULL THEN
   PERFORM cron.unschedule(j);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.selfservice_queue_backstop_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u text; s text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.selfservice_message_queue WHERE status IN ('pending','sending','claimed') AND sent_at IS NULL LIMIT 1) THEN
 SELECT value->>'url' INTO u FROM public.app_settings WHERE key='selfservice_queue_worker_url';
 SELECT value INTO s FROM public.internal_function_secrets WHERE key='cron_secret';
 IF u IS NULL OR s IS NULL THEN RAISE EXCEPTION 'Queue backstop configuration missing'; END IF;
 PERFORM net.http_post(url:=u,headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',s),body:='{}'::jsonb,timeout_milliseconds:=55000);
 END IF;
 PERFORM public.selfservice_queue_backstop_refresh();
END $$;
CREATE OR REPLACE FUNCTION public.selfservice_queue_backstop_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.selfservice_queue_backstop_refresh(); RETURN NULL; END $$;
CREATE TRIGGER selfservice_queue_backstop_insert AFTER INSERT ON public.selfservice_message_queue FOR EACH STATEMENT EXECUTE FUNCTION public.selfservice_queue_backstop_changed();
CREATE TRIGGER selfservice_queue_backstop_status AFTER UPDATE OF status ON public.selfservice_message_queue FOR EACH STATEMENT EXECUTE FUNCTION public.selfservice_queue_backstop_changed();
REVOKE ALL ON FUNCTION public.selfservice_queue_backstop_refresh(), public.selfservice_queue_backstop_tick(), public.selfservice_queue_backstop_changed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_backstop_refresh(), public.selfservice_queue_backstop_tick() TO service_role;
CREATE OR REPLACE FUNCTION public.selfservice_queue_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.selfservice_message_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.selfservice_message_queue q SET status='pending',claimed_at=NULL,next_attempt_at=now()
 WHERE q.id IN (SELECT id FROM public.selfservice_message_queue WHERE status IN ('sending','claimed') AND sent_at IS NULL AND claimed_at < now()-interval '2 minutes' ORDER BY claimed_at LIMIT 50 FOR UPDATE SKIP LOCKED);
 RETURN QUERY
 WITH candidates AS (
 SELECT q.id FROM public.selfservice_message_queue q
 WHERE q.status='pending' AND q.sent_at IS NULL AND q.next_attempt_at<=now()
 AND NOT EXISTS (SELECT 1 FROM public.selfservice_message_queue earlier
 WHERE earlier.whatsapp_number_id IS NOT DISTINCT FROM q.whatsapp_number_id
 AND earlier.status IN ('pending','sending','claimed')
 AND (earlier.created_at,earlier.id)<(q.created_at,q.id))
 ORDER BY q.created_at,q.id LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF q SKIP LOCKED
 )
 UPDATE public.selfservice_message_queue q SET status='sending',claimed_at=clock_timestamp()
 FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;