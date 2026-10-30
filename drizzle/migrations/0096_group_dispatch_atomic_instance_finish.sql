ALTER TABLE public.group_campaign_block_dispatches ADD COLUMN IF NOT EXISTS claim_token uuid;
CREATE OR REPLACE FUNCTION public.claim_group_dispatch_job(p_number_id uuid) RETURNS SETOF public.group_campaign_block_dispatches LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j group_campaign_block_dispatches; route jsonb; v_key uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('group-dispatch-instance:'||p_number_id::text,0));
 IF EXISTS(SELECT 1 FROM group_campaign_block_dispatches WHERE whatsapp_number_id=p_number_id AND status='sending') THEN RETURN; END IF;
 SELECT coalesce(message_group_id,scheduled_message_id) INTO v_key FROM group_campaign_block_dispatches WHERE whatsapp_number_id=p_number_id AND status='pending' AND seq IS NOT NULL ORDER BY created_at,id LIMIT 1;
 SELECT * INTO j FROM group_campaign_block_dispatches WHERE whatsapp_number_id=p_number_id AND coalesce(message_group_id,scheduled_message_id)=v_key AND status='pending' AND seq IS NOT NULL ORDER BY seq,block_order,id LIMIT 1 FOR UPDATE;
 IF j.id IS NULL OR j.send_after IS NULL OR j.send_after>now() OR j.locked_until>now() THEN RETURN; END IF;
 PERFORM 1 FROM whatsapp_group_responsible WHERE group_jid_base=split_part(split_part(j.group_zapi_id,'@',1),'-',1) FOR UPDATE;
 route:=resolve_group_send_route(j.group_zapi_id,coalesce(j.fallback_number_id,j.whatsapp_number_id),j.override_number_id);
 IF NOT (route->>'online')::boolean THEN
 UPDATE group_campaign_block_dispatches SET locked_until=now()+interval '60 seconds',error_message=coalesce(route->>'label','Instância')||' desconectada — grupo aguardando' WHERE id=j.id;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_group_responsible_alerts WHERE group_jid_base=route->>'base' AND kind='send_offline' AND acknowledged_at IS NULL) THEN
 INSERT INTO whatsapp_group_responsible_alerts(group_jid_base,group_name,kind,old_instance_id,new_instance_id,message) VALUES(route->>'base',j.group_name,'send_offline',p_number_id,p_number_id,coalesce(route->>'label','Instância')||' desconectada — grupo aguardando'); END IF;
 RETURN;
 END IF;
 IF (route->>'instance_id')::uuid IS DISTINCT FROM p_number_id THEN
 UPDATE group_campaign_block_dispatches SET whatsapp_number_id=(route->>'instance_id')::uuid,routing_source=route->>'source' WHERE whatsapp_number_id=p_number_id AND coalesce(message_group_id,scheduled_message_id)=v_key AND group_db_id=j.group_db_id AND status='pending';
 RETURN;
 END IF;
 IF NOT (route->>'present')::boolean THEN
 UPDATE group_campaign_block_dispatches SET error_message='instância não participa do grupo',locked_until=now()+interval '60 seconds' WHERE id=j.id; RETURN;
 END IF;
 RETURN QUERY UPDATE group_campaign_block_dispatches SET status='sending',started_at=now(),claim_token=gen_random_uuid(),locked_until=now()+interval '120 seconds',routing_source=route->>'source',group_zapi_id=route->>'group_jid',error_message=NULL WHERE id=j.id RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.get_group_dispatch_ready_instances() RETURNS TABLE(whatsapp_number_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT j.whatsapp_number_id FROM group_campaign_block_dispatches j WHERE j.status='pending' AND j.seq IS NOT NULL AND j.send_after<=now() AND (j.locked_until IS NULL OR j.locked_until<now()) AND j.whatsapp_number_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM group_campaign_block_dispatches x WHERE x.whatsapp_number_id=j.whatsapp_number_id AND x.status='sending') $$;
CREATE OR REPLACE FUNCTION public.finish_group_dispatch_job(p_id uuid,p_token uuid,p_outcome text,p_attempts int DEFAULT 0,p_error text DEFAULT NULL,p_message_id text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j group_campaign_block_dispatches; colkey uuid; ids uuid[]; successes int; failures int; remains int; total_remaining int; anchor uuid;
BEGIN
 SELECT * INTO j FROM group_campaign_block_dispatches WHERE id=p_id;
 IF j.id IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('group-dispatch-instance:'||j.whatsapp_number_id::text,0));
 colkey:=coalesce(j.message_group_id,j.scheduled_message_id);
 SELECT id INTO anchor FROM group_campaign_scheduled_messages WHERE id=j.scheduled_message_id OR (j.message_group_id IS NOT NULL AND message_group_id=j.message_group_id) ORDER BY id LIMIT 1 FOR UPDATE;
 SELECT * INTO j FROM group_campaign_block_dispatches WHERE id=p_id FOR UPDATE;
 IF j.status<>'sending' OR j.claim_token IS DISTINCT FROM p_token THEN RETURN false; END IF;
 IF p_outcome NOT IN ('sent','failed','cancelled') THEN RAISE EXCEPTION 'resultado inválido'; END IF;
 UPDATE group_campaign_block_dispatches SET status=p_outcome,attempts=p_attempts,error_message=p_error,provider_message_id=p_message_id,sent_at=CASE WHEN p_outcome='sent' THEN now() ELSE NULL END,locked_until=NULL WHERE id=p_id;
 UPDATE group_campaign_block_dispatches SET send_after=clock_timestamp()+greatest(coalesce(j.delay_after_ms,0),0)*interval '1 millisecond' WHERE id=(SELECT id FROM group_campaign_block_dispatches WHERE whatsapp_number_id=j.whatsapp_number_id AND coalesce(message_group_id,scheduled_message_id)=colkey AND status='pending' AND seq>j.seq ORDER BY seq,block_order,id LIMIT 1) AND send_after IS NULL;
 WITH groups AS (SELECT group_db_id,count(*) FILTER(WHERE status IN ('pending','sending')) pending,bool_or(status='sent') sent,bool_or(status='failed') failed FROM group_campaign_block_dispatches WHERE coalesce(message_group_id,scheduled_message_id)=colkey AND seq IS NOT NULL GROUP BY group_db_id)
 SELECT coalesce(array_agg(group_db_id) FILTER(WHERE pending=0),'{}'::uuid[]),count(*) FILTER(WHERE pending=0 AND sent),count(*) FILTER(WHERE pending=0 AND failed),coalesce(sum(pending),0) INTO ids,successes,failures,total_remaining FROM groups;
 UPDATE group_campaign_scheduled_messages SET sent_group_ids=ids,sent_count=successes,failed_count=failures,status=CASE WHEN total_remaining=0 THEN 'sent' ELSE 'sending' END,sent_at=CASE WHEN total_remaining=0 THEN now() ELSE sent_at END,locked_until=CASE WHEN total_remaining=0 THEN NULL ELSE now()+interval '120 seconds' END WHERE id=j.scheduled_message_id OR (j.message_group_id IS NOT NULL AND message_group_id=j.message_group_id);
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.group_send_offline_summary(p_limit int DEFAULT 50,p_offset int DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
 WITH waiting AS (
 SELECT whatsapp_number_id,split_part(split_part(group_zapi_id,'@',1),'-',1) base FROM group_campaign_block_dispatches WHERE status='pending'
 UNION SELECT whatsapp_number_id,split_part(split_part(group_jid,'@',1),'-',1) FROM group_admin_actions WHERE status='queued'
 ), totals AS (SELECT n.id,n.label,count(DISTINCT w.base) groups FROM waiting w JOIN whatsapp_numbers n ON n.id=w.whatsapp_number_id WHERE n.is_online=false OR NOT n.is_active GROUP BY n.id,n.label ORDER BY n.label LIMIT least(greatest(p_limit,1),200) OFFSET greatest(p_offset,0))
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'groups',groups)),'[]'::jsonb) INTO result FROM totals;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_group_dispatch_job(uuid),public.get_group_dispatch_ready_instances(),public.finish_group_dispatch_job(uuid,uuid,text,int,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_group_dispatch_job(uuid),public.get_group_dispatch_ready_instances(),public.finish_group_dispatch_job(uuid,uuid,text,int,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.group_send_offline_summary(int,int) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.group_send_offline_summary(int,int) TO authenticated,service_role;