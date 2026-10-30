-- Transactional fixtures only; no provider calls, no persisted customer/group edits.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE
 p uuid:='0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c';
 c uuid:='fb7dd381-6460-4f28-8d01-f15943edb879';
 center uuid:='1f715932-e118-4e88-8051-85a5c14f5a4b';
 gp uuid:=gen_random_uuid(); gc uuid:=gen_random_uuid(); gf uuid:=gen_random_uuid();
 campaign uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); m2 uuid:=gen_random_uuid();
 d1 uuid; d2 uuid; dc uuid; later uuid; admin_id uuid;
 j group_campaign_block_dispatches; other group_campaign_block_dispatches; route jsonb; lease jsonb;
BEGIN
 UPDATE whatsapp_numbers SET is_online=true WHERE id IN(p,c,center);
 INSERT INTO whatsapp_groups(id,group_id,group_jid_base,name,instance_id,is_active,is_admin) VALUES
 (gp,'12039999000001@g.us','12039999000001','Fixture Pérola',p::text,true,true),
 (gc,'12039999000002@g.us','12039999000002','Fixture Carol',c::text,true,true),
 (gf,'12039999000003@g.us','12039999000003','Fixture sem admin',p::text,true,false);
 route:=resolve_group_send_route('12039999000001@g.us',c,NULL);
 IF route->>'instance_id'<>p::text OR route->>'source'<>'responsible' THEN RAISE EXCEPTION 'responsible must override campaign'; END IF;
 route:=resolve_group_send_route('12039999000001-group',c,c);
 IF route->>'instance_id'<>c::text OR route->>'source'<>'override' THEN RAISE EXCEPTION 'explicit override not preserved'; END IF;
 route:=resolve_group_send_route('12039999999999@g.us',c,NULL);
 IF route->>'instance_id'<>c::text OR route->>'source'<>'fallback' THEN RAISE EXCEPTION 'missing responsible must use campaign'; END IF;
 UPDATE app_settings SET value='false'::jsonb WHERE key='group_send_via_responsible';
 route:=resolve_group_send_route('12039999000001@g.us',c,NULL);
 IF route->>'instance_id'<>c::text OR route->>'source'<>'legacy' THEN RAISE EXCEPTION 'disabled flag must restore campaign'; END IF;
 UPDATE app_settings SET value='true'::jsonb WHERE key='group_send_via_responsible';
 INSERT INTO group_admin_actions(whatsapp_number_id,group_db_id,group_jid,action_type,payload) VALUES(c,gf,'12039999000003@g.us','rename','{"name":"Fixture"}') RETURNING id INTO admin_id;
 IF (SELECT status FROM group_admin_actions WHERE id=admin_id)<>'failed' OR (SELECT error_message FROM group_admin_actions WHERE id=admin_id)<>'instância responsável não é admin' THEN RAISE EXCEPTION 'sem_admin must fail without provider call'; END IF;
 INSERT INTO group_campaigns(id,name,target_groups,whatsapp_number_id,status) VALUES(campaign,'Fixture phase C',ARRAY[gp,gc],c,'active');
 INSERT INTO group_campaign_scheduled_messages(id,campaign_id,message_type,message_content,status) VALUES(m,campaign,'text','Fixture','sending'),(m2,campaign,'text','Fixture 2','sending');
 INSERT INTO group_campaign_block_dispatches(scheduled_message_id,campaign_id,group_db_id,group_zapi_id,whatsapp_number_id,fallback_number_id,block_order,status,seq,send_after,delay_after_ms) VALUES(m,campaign,gp,'12039999000001@g.us',p,c,0,'pending',1,now(),4000) RETURNING id INTO d1;
 INSERT INTO group_campaign_block_dispatches(scheduled_message_id,campaign_id,group_db_id,group_zapi_id,whatsapp_number_id,fallback_number_id,block_order,status,seq,send_after,delay_after_ms) VALUES(m,campaign,gp,'12039999000001@g.us',p,c,1,'pending',2,NULL,0) RETURNING id INTO d2;
 INSERT INTO group_campaign_block_dispatches(scheduled_message_id,campaign_id,group_db_id,group_zapi_id,whatsapp_number_id,fallback_number_id,block_order,status,seq,send_after,delay_after_ms) VALUES(m,campaign,gc,'12039999000002@g.us',c,p,0,'pending',1,now(),0) RETURNING id INTO dc;
 INSERT INTO group_campaign_block_dispatches(scheduled_message_id,campaign_id,group_db_id,group_zapi_id,whatsapp_number_id,fallback_number_id,block_order,status,seq,send_after,delay_after_ms) VALUES(m2,campaign,gp,'12039999000001@g.us',p,c,0,'pending',1,now(),0) RETURNING id INTO later;
 SELECT * INTO j FROM claim_group_dispatch_job(p);
 IF j.id IS DISTINCT FROM d1 OR j.status<>'sending' THEN RAISE EXCEPTION 'claim did not mark sending'; END IF;
 SELECT * INTO other FROM claim_group_dispatch_job(p);
 IF other.id IS NOT NULL THEN RAISE EXCEPTION 'same instance claimed twice'; END IF;
 SELECT * INTO other FROM claim_group_dispatch_job(c);
 IF other.id IS DISTINCT FROM dc THEN RAISE EXCEPTION 'different instance blocked'; END IF;
 IF NOT group_send_in_progress('12039999000001') THEN RAISE EXCEPTION 'sending group not busy'; END IF;
 PERFORM finish_group_dispatch_job(j.id,j.claim_token,'sent',1,NULL,'fixture-id-perola');
 IF (SELECT send_after FROM group_campaign_block_dispatches WHERE id=d2)<now()+interval '3990 milliseconds' THEN RAISE EXCEPTION '4000 ms interval lost'; END IF;
 IF (SELECT status FROM group_campaign_scheduled_messages WHERE id=m)<>'sending' THEN RAISE EXCEPTION 'parallel sending prematurely completed'; END IF;
 PERFORM finish_group_dispatch_job(other.id,other.claim_token,'sent',1,NULL,'fixture-id-carol');
 IF (SELECT sent_count FROM group_campaign_scheduled_messages WHERE id=m)<>1 THEN RAISE EXCEPTION 'parallel count lost'; END IF;
 UPDATE group_campaign_block_dispatches SET send_after=now(),locked_until=NULL WHERE id=d2;
 UPDATE whatsapp_numbers SET is_online=false WHERE id=p;
 SELECT * INTO j FROM claim_group_dispatch_job(p);
 IF j.id IS NOT NULL OR (SELECT status FROM group_campaign_block_dispatches WHERE id=d2)<>'pending' THEN RAISE EXCEPTION 'offline must remain pending'; END IF;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_group_responsible_alerts WHERE group_jid_base='12039999000001' AND kind='send_offline') THEN RAISE EXCEPTION 'offline alert missing'; END IF;
 UPDATE whatsapp_numbers SET is_online=true WHERE id=p;
 UPDATE group_campaign_block_dispatches SET locked_until=NULL WHERE id=d2;
 SELECT * INTO j FROM claim_group_dispatch_job(p);
 IF j.id IS DISTINCT FROM d2 THEN RAISE EXCEPTION 'reconnected failed to resume'; END IF;
 PERFORM finish_group_dispatch_job(j.id,j.claim_token,'sent',1,NULL,'fixture-second');
 IF (SELECT sent_count FROM group_campaign_scheduled_messages WHERE id=m)<>2 OR (SELECT cardinality(sent_group_ids) FROM group_campaign_scheduled_messages WHERE id=m)<>2 THEN RAISE EXCEPTION 'group count or identifiers lost'; END IF;
 IF (SELECT status FROM group_campaign_scheduled_messages WHERE id=m)<>'sent' THEN RAISE EXCEPTION 'finished dispatch not sent'; END IF;
 IF finish_group_dispatch_job(j.id,j.claim_token,'sent',1,NULL,'duplicate') THEN RAISE EXCEPTION 'duplicate finish accepted'; END IF;
 lease:=reserve_direct_group_send('12039999000002@g.us',NULL,NULL);
 IF lease->>'instance_id'<>c::text OR NOT group_send_in_progress('12039999000002') THEN RAISE EXCEPTION 'direct send not protected'; END IF;
 PERFORM finish_direct_group_send((lease->>'lease_id')::uuid,'sent','fixture-direct');
END $$;
ROLLBACK;