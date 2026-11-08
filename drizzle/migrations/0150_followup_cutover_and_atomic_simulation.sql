CREATE OR REPLACE FUNCTION public.live_followup_dirty() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v_key text; BEGIN IF NOT public.live_followup_enabled(NEW.event_id) THEN RETURN NEW; END IF; v_key:=TG_TABLE_NAME||':'||NEW.id; INSERT INTO live_followup_sources(source_key,event_id,order_id,access_id,changed_at) VALUES(v_key,NEW.event_id,CASE WHEN TG_TABLE_NAME='orders' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='live_selfservice_accesses' THEN NEW.id END,clock_timestamp()) ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at;
 IF TG_TABLE_NAME='live_selfservice_accesses' AND cardinality(NEW.order_ids)>0 THEN INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT 'orders:'||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at; END IF;
 RETURN NEW; EXCEPTION WHEN others THEN RAISE WARNING '[live-followup-dirty] %',SQLERRM; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.live_followup_dirty() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_dirty() TO service_role;
CREATE OR REPLACE FUNCTION public.live_followup_switch_stop() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_TABLE_NAME='events' THEN UPDATE live_followup_jobs SET status='cancelled',reason='event_disabled' WHERE event_id=NEW.id AND status='pending';
 ELSE IF NOT coalesce((NEW.value->>'enabled')::boolean,false) THEN UPDATE live_followup_jobs SET status='cancelled',reason='global_disabled' WHERE status='pending';
 ELSE UPDATE live_followup_jobs SET status='cancelled',reason='type_disabled' WHERE status='pending' AND NOT coalesce((NEW.value->'types'->type->>'enabled')::boolean,false);
 IF NOT coalesce((OLD.value->>'enabled')::boolean,false) THEN UPDATE event_followup_dispatches SET status='skipped',skip_reason='replaced_by_global' WHERE status='pending'; END IF;
 END IF; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.live_followup_switch_stop() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_switch_stop() TO service_role;
CREATE OR REPLACE FUNCTION public.live_followup_simulate() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ev uuid:=gen_random_uuid(); inst uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); cfg jsonb; r jsonb:='{}'; n integer; x record;
BEGIN
 IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT value INTO cfg FROM live_followup_settings WHERE id; IF cfg IS NULL THEN RAISE EXCEPTION 'Save default configuration first'; END IF;
 BEGIN
 INSERT INTO events(id,name,live_followup_enabled) VALUES(ev,'SIMULAÇÃO ISOLADA FOLLOWUP',true);
 UPDATE live_followup_settings SET value=jsonb_set(cfg,'{enabled}','true');
 INSERT INTO live_followup_jobs(id,event_id,customer_key,whatsapp_number_id,channel,type,step,sequence_key,scheduled_at,base_at) VALUES(job,ev,'simulate-customer',inst,'whatsapp','D',0,'simulate-sequence',now(),now());
 INSERT INTO live_followup_jobs(event_id,customer_key,whatsapp_number_id,channel,type,step,sequence_key,scheduled_at,base_at) VALUES(ev,'simulate-customer',inst,'whatsapp','D',0,'simulate-sequence',now(),now()) ON CONFLICT(customer_key,sequence_key,step) DO NOTHING;
 SELECT count(*) INTO n FROM live_followup_jobs WHERE sequence_key='simulate-sequence'; r:=r||jsonb_build_object('unique_step',n=1);
 FOR x IN SELECT * FROM live_followup_claim(50) LOOP IF x.id=job THEN r:=r||jsonb_build_object('claim_first',true); END IF; END LOOP;
 SELECT count(*) INTO n FROM live_followup_claim(50) WHERE id=job; r:=r||jsonb_build_object('claim_no_duplicate',n=0);
 UPDATE live_followup_jobs SET status='sent',sent_at=now() WHERE id=job;
 UPDATE live_followup_instances SET next_send_at=now()-interval '1 second' WHERE whatsapp_number_id=inst;
 INSERT INTO live_followup_jobs(event_id,customer_key,whatsapp_number_id,channel,type,step,sequence_key,scheduled_at,base_at,status,claimed_at) SELECT ev,'history-'||x,inst,'whatsapp','D',0,'history-'||x,now(),now(),'sent',now() FROM generate_series(1,39) x;
 INSERT INTO live_followup_jobs(event_id,customer_key,whatsapp_number_id,channel,type,step,sequence_key,scheduled_at,base_at) VALUES(ev,'next-customer',inst,'whatsapp','D',0,'next-sequence',now(),now());
 SELECT count(*) INTO n FROM live_followup_claim(50) WHERE whatsapp_number_id=inst;r:=r||jsonb_build_object('hourly_40_limit',n=0);
 UPDATE events SET live_followup_enabled=false WHERE id=ev;
 SELECT count(*) INTO n FROM live_followup_jobs WHERE event_id=ev AND status='pending';r:=r||jsonb_build_object('event_off_cancels',n=0);
 RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='rollback simulation';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL;
 END;
 RETURN r||jsonb_build_object('simulated',true,'provider_calls',0);
END $$;
REVOKE ALL ON FUNCTION public.live_followup_simulate() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_followup_simulate() TO authenticated;
CREATE OR REPLACE FUNCTION public.live_followup_history(p_event_id uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0) RETURNS SETOF public.live_followup_jobs LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'events')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN QUERY SELECT * FROM live_followup_jobs WHERE p_event_id IS NULL OR event_id=p_event_id ORDER BY created_at DESC,id DESC LIMIT least(greatest(p_limit,1),100) OFFSET greatest(p_offset,0); END $$;
REVOKE ALL ON FUNCTION public.live_followup_history(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_followup_history(uuid,integer,integer) TO authenticated;