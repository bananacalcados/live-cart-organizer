-- Transactional integration test: no WhatsApp sends and no persistent fixtures.
BEGIN;
DO $$
DECLARE
 n uuid := gen_random_uuid(); r uuid; k text := 'queue-test-'||gen_random_uuid();
 d integer; deadline timestamptz; before_count integer; after_count integer;
BEGIN
 -- Each admitted send samples 3–7 s and rejected checks preserve the sample.
 FOR i IN 1..50 LOOP
   UPDATE public.selfservice_instance_pacing SET next_send_at=clock_timestamp()-interval '1 second' WHERE whatsapp_number_id=n::text;
   IF NOT public.selfservice_instance_gate(n::text,4000) THEN RAISE EXCEPTION 'gate not admitted'; END IF;
   SELECT delay_ms,next_send_at INTO d,deadline FROM public.selfservice_instance_pacing WHERE whatsapp_number_id=n::text;
   IF d < 3000 OR d > 7000 THEN RAISE EXCEPTION 'delay outside 3–7 seconds: %',d; END IF;
   IF public.selfservice_instance_gate(n::text,4000) THEN RAISE EXCEPTION 'early send admitted'; END IF;
   IF deadline IS DISTINCT FROM (SELECT next_send_at FROM public.selfservice_instance_pacing WHERE whatsapp_number_id=n::text) THEN RAISE EXCEPTION 'delay resampled on rejected check'; END IF;
 END LOOP;
 -- Different instance does not wait for this one.
 IF NOT public.selfservice_instance_gate(gen_random_uuid()::text,4000) THEN RAISE EXCEPTION 'independent instance blocked'; END IF;
 PERFORM public.selfservice_queue_enqueue(k,NULL,NULL,'cart_link','5500000000000',n,'{}');
 SELECT id INTO r FROM public.selfservice_message_queue WHERE message_key=k;
 PERFORM public.selfservice_queue_enqueue(k,NULL,NULL,'cart_link','5500000000000',n,'{}');
 IF (SELECT count(*) FROM public.selfservice_message_queue WHERE message_key=k) <> 1 THEN RAISE EXCEPTION 'duplicate message key'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='selfservice-message-queue-backstop' AND schedule='* * * * *' AND active) THEN RAISE EXCEPTION 'minute backstop not armed'; END IF;
 -- Requeue updates the same row/key, never inserts another message.
 SELECT count(*) INTO before_count FROM public.selfservice_message_queue;
 UPDATE public.selfservice_message_queue SET status='failed' WHERE id=r;
 IF NOT public.selfservice_queue_requeue(r) THEN RAISE EXCEPTION 'manual requeue failed'; END IF;
 SELECT count(*) INTO after_count FROM public.selfservice_message_queue;
 IF before_count<>after_count OR NOT EXISTS(SELECT 1 FROM public.selfservice_message_queue WHERE id=r AND message_key=k AND status='pending') THEN RAISE EXCEPTION 'requeue changed identity'; END IF;
 -- A reservation older than 2 minutes without sent_at is recovered.
 UPDATE public.selfservice_message_queue SET status='sending',claimed_at=now()-interval '121 seconds',next_attempt_at=now()+interval '1 day' WHERE id=r;
 PERFORM public.selfservice_queue_claim(20);
 IF NOT EXISTS(SELECT 1 FROM public.selfservice_message_queue WHERE id=r AND status='sending' AND claimed_at>now()-interval '1 second') THEN RAISE EXCEPTION 'stale reservation not recovered'; END IF;
 -- A fresh lease must NOT be stolen by another worker.
 PERFORM public.selfservice_queue_claim(20);
 IF NOT EXISTS(SELECT 1 FROM public.selfservice_message_queue WHERE id=r AND status='sending') THEN RAISE EXCEPTION 'fresh lease stolen'; END IF;
 UPDATE public.selfservice_message_queue SET status='sent',sent_at=now() WHERE id=r;
 IF NOT EXISTS(SELECT 1 FROM public.selfservice_message_queue WHERE status IN ('pending','sending','claimed') AND sent_at IS NULL)
 AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='selfservice-message-queue-backstop') THEN RAISE EXCEPTION 'backstop not removed after drain'; END IF;
END $$;
ROLLBACK;