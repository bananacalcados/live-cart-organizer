CREATE OR REPLACE FUNCTION public.live_followup_claim(p_limit integer DEFAULT 20) RETURNS SETOF public.live_followup_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j live_followup_jobs; cfg jsonb; pacing live_followup_instances; v_hour integer; v_day integer; v_min integer; v_max integer; chosen integer; used integer[];
BEGIN SELECT value INTO cfg FROM live_followup_settings WHERE id; IF NOT coalesce((cfg->>'enabled')::boolean,false) THEN UPDATE live_followup_jobs SET status='cancelled',reason='global_disabled' WHERE status='pending'; RETURN; END IF;
FOR j IN SELECT * FROM live_followup_jobs WHERE status='pending' AND scheduled_at<=now() ORDER BY scheduled_at,id LIMIT least(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED LOOP
IF NOT public.live_followup_enabled(j.event_id) THEN UPDATE live_followup_jobs SET status='cancelled',reason='event_disabled' WHERE id=j.id; CONTINUE; END IF;
IF j.whatsapp_number_id IS NULL THEN UPDATE live_followup_jobs SET status='skipped',reason='no_instance' WHERE id=j.id; CONTINUE; END IF;
INSERT INTO live_followup_instances(whatsapp_number_id) VALUES(j.whatsapp_number_id) ON CONFLICT DO NOTHING;
SELECT * INTO pacing FROM live_followup_instances WHERE whatsapp_number_id=j.whatsapp_number_id FOR UPDATE;
IF pacing.paused OR pacing.next_send_at>now() THEN CONTINUE; END IF;
IF EXISTS(SELECT 1 FROM live_followup_jobs WHERE whatsapp_number_id=j.whatsapp_number_id AND status IN ('processing','uncertain')) THEN CONTINUE; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(j.customer_key,72819));
SELECT count(*) INTO v_hour FROM live_followup_jobs WHERE whatsapp_number_id=j.whatsapp_number_id AND claimed_at>now()-interval '1 hour'; IF v_hour>=coalesce((cfg->'limits'->>'hourly')::integer,40) THEN CONTINUE; END IF;
SELECT count(*) INTO v_day FROM live_followup_jobs WHERE customer_key=j.customer_key AND claimed_at>=((now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo'); IF v_day>=coalesce((cfg->'limits'->>'daily_customer')::integer,6) THEN UPDATE live_followup_jobs SET status='skipped',reason='customer_daily_limit' WHERE id=j.id; CONTINUE; END IF;
IF j.type='D' AND now()>j.scheduled_at+interval '15 minutes' THEN UPDATE live_followup_jobs SET status='skipped',reason='late_step' WHERE id=j.id; CONTINUE; END IF;
IF j.step>0 AND EXISTS(SELECT 1 FROM live_followup_jobs WHERE sequence_key=j.sequence_key AND step<j.step AND status IN ('pending','processing','uncertain')) THEN CONTINUE; END IF;
SELECT array_agg(variant) INTO used FROM live_followup_jobs WHERE customer_key=j.customer_key AND type=j.type AND step=j.step AND variant IS NOT NULL AND status IN ('sent','processing','uncertain'); SELECT x INTO chosen FROM generate_series(0,2) x WHERE NOT x=ANY(coalesce(used,'{}'::integer[])) ORDER BY random() LIMIT 1;
IF chosen IS NULL THEN UPDATE live_followup_jobs SET status='skipped',reason='variations_exhausted' WHERE id=j.id; CONTINUE; END IF;
v_min:=coalesce((cfg->'limits'->>'interval_min')::integer,20);v_max:=coalesce((cfg->'limits'->>'interval_max')::integer,60);
UPDATE live_followup_instances SET next_send_at=clock_timestamp()+make_interval(secs=>v_min+floor(random()*(v_max-v_min+1))::integer) WHERE whatsapp_number_id=j.whatsapp_number_id;
UPDATE live_followup_jobs SET status='processing',claimed_at=clock_timestamp(),variant=chosen WHERE id=j.id RETURNING * INTO j; RETURN NEXT j;
END LOOP; END $$;
REVOKE ALL ON FUNCTION public.live_followup_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_claim(integer) TO service_role;
CREATE OR REPLACE FUNCTION public.live_followup_switch_stop() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='events' THEN
  UPDATE live_followup_jobs SET status='cancelled',reason='event_disabled' WHERE event_id=NEW.id AND status='pending';
 ELSE
  IF NOT coalesce((NEW.value->>'enabled')::boolean,false) THEN UPDATE live_followup_jobs SET status='cancelled',reason='global_disabled' WHERE status='pending';
  ELSE UPDATE live_followup_jobs SET status='cancelled',reason='type_disabled' WHERE status='pending' AND NOT coalesce((NEW.value->'types'->type->>'enabled')::boolean,false);
  END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_switch_stop() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_switch_stop() TO service_role;
CREATE TRIGGER live_followup_global_stop AFTER UPDATE ON public.live_followup_settings FOR EACH ROW WHEN (OLD.value IS DISTINCT FROM NEW.value) EXECUTE FUNCTION public.live_followup_switch_stop();
CREATE TRIGGER live_followup_event_stop AFTER UPDATE OF live_followup_enabled ON public.events FOR EACH ROW WHEN (OLD.live_followup_enabled IS DISTINCT FROM NEW.live_followup_enabled AND NEW.live_followup_enabled=false) EXECUTE FUNCTION public.live_followup_switch_stop();
CREATE OR REPLACE FUNCTION public.live_followup_reconcile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF NEW.is_paid OR NEW.paid_externally OR NEW.stage IN ('cancelled','refunded') OR NEW.merged_into_order_id IS NOT NULL OR jsonb_array_length(coalesce(NEW.products,'[]'))=0 THEN
   UPDATE live_followup_jobs SET status='cancelled',reason='order_closed' WHERE order_id=NEW.id AND status='pending';
  END IF;
 ELSE
  IF NEW.registered_at IS NOT NULL OR NEW.whatsapp_confirmed_at IS NOT NULL THEN UPDATE live_followup_jobs SET status='cancelled',reason='registration_completed' WHERE access_id=NEW.id AND type='A' AND status='pending'; END IF;
  IF cardinality(NEW.order_ids)>0 THEN
   INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT 'orders:'||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at;
  END IF;
 END IF;RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING '[live-followup-reconcile] %',SQLERRM; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_reconcile() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_reconcile() TO service_role;
CREATE TRIGGER live_followup_order_reconcile AFTER UPDATE ON public.orders FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage OR OLD.products IS DISTINCT FROM NEW.products OR OLD.is_paid IS DISTINCT FROM NEW.is_paid OR OLD.paid_externally IS DISTINCT FROM NEW.paid_externally OR OLD.merged_into_order_id IS DISTINCT FROM NEW.merged_into_order_id) EXECUTE FUNCTION public.live_followup_reconcile();
CREATE TRIGGER live_followup_access_reconcile AFTER UPDATE ON public.live_selfservice_accesses FOR EACH ROW WHEN (OLD.registered_at IS DISTINCT FROM NEW.registered_at OR OLD.whatsapp_confirmed_at IS DISTINCT FROM NEW.whatsapp_confirmed_at OR OLD.order_ids IS DISTINCT FROM NEW.order_ids) EXECUTE FUNCTION public.live_followup_reconcile();