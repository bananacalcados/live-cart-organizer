CREATE OR REPLACE FUNCTION public.live_followup_button_simulate() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ev uuid:=gen_random_uuid(); customer uuid; ord uuid:=gen_random_uuid(); nid uuid; job uuid:=gen_random_uuid(); uname text:='sim_'||substr(replace(gen_random_uuid()::text,'-',''),1,12); sender text:='9'||substr(replace(gen_random_uuid()::text,'-',''),1,15); clicked timestamptz:=now(); claimed uuid; result jsonb:='{}'; ctx jsonb; uid uuid:=auth.uid();
BEGIN
 IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT id INTO nid FROM whatsapp_numbers WHERE provider='instagram' AND is_active LIMIT 1;
 SELECT id INTO customer FROM customers LIMIT 1;
 IF nid IS NULL OR customer IS NULL THEN RAISE EXCEPTION 'No simulation base'; END IF;
 BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true); PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',uid)::text,true);
 UPDATE live_followup_settings SET value=jsonb_set(value,'{enabled}','true');
 INSERT INTO events(id,name,live_followup_enabled,self_service_slug) VALUES(ev,'SIM BUTTON POLICY',true,'sim-button-'||substr(ev::text,1,8));
 INSERT INTO orders(id,event_id,customer_id,products,stage) VALUES(ord,ev,customer,'[{"title":"sim","quantity":1}]','new');
 INSERT INTO instagram_user_links(username,ig_user_id) VALUES(uname,sender);
 INSERT INTO live_followup_jobs(id,event_id,order_id,customer_key,instagram,whatsapp_number_id,channel,type,step,sequence_key,base_at,scheduled_at,status,sent_at,reason,button_expires_at) VALUES(job,ev,ord,'ig:'||uname,uname,nid,'instagram','F',0,'sim:'||job,now()-interval '3 minutes',now()-interval '2 minutes','sent',now()-interval '1 minute','aguardando_toque',now()+interval '24 hours');
 INSERT INTO whatsapp_messages(phone,whatsapp_number_id,message,direction,channel,source,created_at) VALUES(sender,nid,'Quero meu link 🛍️','incoming','instagram','ig_interaction',clicked);
 ctx:=live_followup_job_context(job);
 result:=result||jsonb_build_object('click_not_response',NOT coalesce((ctx->>'customer_replied')::boolean,false),'click_opens_window',coalesce((ctx->'instagram_context'->>'window_open')::boolean,false));
 result:=result||jsonb_build_object('wrong_sender_blocked',live_followup_button_claim(job,'wrong',nid,clicked) IS NULL);
 claimed:=live_followup_button_claim(job,sender,nid,clicked);
 result:=result||jsonb_build_object('click_claimed',claimed IS NOT NULL,'duplicate_click_blocked',live_followup_button_claim(job,sender,nid,clicked) IS NULL,'no_followups_before_cart',NOT EXISTS(SELECT 1 FROM live_followup_jobs WHERE event_id=ev AND step>0));
 result:=result||jsonb_build_object('cart_confirmed',live_followup_button_finish(claimed,'SIM-NO-PROVIDER'));
 result:=result||jsonb_build_object('three_followups', (SELECT count(*)=3 FROM live_followup_jobs WHERE event_id=ev AND step IN (1,2,3)),'click_time_base',NOT EXISTS(SELECT 1 FROM live_followup_jobs WHERE event_id=ev AND step>0 AND base_at IS DISTINCT FROM clicked),'10_25_45_jitter',NOT EXISTS(SELECT 1 FROM live_followup_jobs WHERE event_id=ev AND step>0 AND abs(extract(epoch from (scheduled_at-base_at))/60-CASE step WHEN 1 THEN 10 WHEN 2 THEN 25 ELSE 45 END)>1));
 INSERT INTO whatsapp_messages(phone,whatsapp_number_id,message,direction,channel,created_at) VALUES(sender,nid,'Oi, tenho uma dúvida','incoming','instagram',clicked+interval '1 second');
 ctx:=live_followup_job_context(claimed);
 result:=result||jsonb_build_object('typed_text_stops',coalesce((ctx->>'customer_replied')::boolean,false));
 RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback simulation';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 RETURN result||jsonb_build_object('rolled_back',true,'provider_calls',0);
END $$;
REVOKE ALL ON FUNCTION public.live_followup_button_simulate() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.live_followup_button_simulate() TO authenticated;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.live_followup_claim(integer)'::regprocedure) INTO def;
 def:=replace(def,'BEGIN SELECT value', $s$BEGIN UPDATE live_followup_jobs SET reason='toque_expirado' WHERE type='F' AND step=0 AND status='sent' AND reason='aguardando_toque' AND button_expires_at<=now(); SELECT value$s$);
 EXECUTE def;
END $$;