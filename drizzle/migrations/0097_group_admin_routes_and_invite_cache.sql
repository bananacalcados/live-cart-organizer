ALTER TABLE public.group_redirect_links ADD COLUMN IF NOT EXISTS cached_group_base text;
ALTER TABLE public.group_redirect_links ADD COLUMN IF NOT EXISTS cached_instance_id uuid;
CREATE OR REPLACE FUNCTION public.refresh_group_admin_send_routes(p_limit int DEFAULT 200) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a group_admin_actions; route jsonb; changed int:=0;
BEGIN
 FOR a IN SELECT * FROM group_admin_actions WHERE status='queued' AND (locked_until IS NULL OR locked_until<now()) ORDER BY created_at,id LIMIT least(greatest(p_limit,1),200) FOR UPDATE SKIP LOCKED LOOP
 PERFORM 1 FROM whatsapp_group_responsible WHERE group_jid_base=split_part(split_part(a.group_jid,'@',1),'-',1) FOR UPDATE;
 route:=resolve_group_send_route(a.group_jid,coalesce(a.fallback_number_id,a.whatsapp_number_id),a.override_number_id);
 IF group_send_responsible_enabled() AND NOT (route->>'is_admin')::boolean THEN
 UPDATE group_admin_actions SET status='failed',error_message='instância responsável não é admin',finished_at=now(),updated_at=now() WHERE id=a.id; changed:=changed+1;
 ELSE
 UPDATE group_admin_actions SET fallback_number_id=coalesce(fallback_number_id,whatsapp_number_id),whatsapp_number_id=coalesce((route->>'instance_id')::uuid,whatsapp_number_id),group_jid=route->>'group_jid',updated_at=now() WHERE id=a.id AND (fallback_number_id IS NULL OR whatsapp_number_id IS DISTINCT FROM (route->>'instance_id')::uuid OR group_jid IS DISTINCT FROM route->>'group_jid');
 IF NOT (route->>'online')::boolean AND NOT EXISTS(SELECT 1 FROM whatsapp_group_responsible_alerts WHERE group_jid_base=route->>'base' AND kind='send_offline' AND acknowledged_at IS NULL) THEN
 INSERT INTO whatsapp_group_responsible_alerts(group_jid_base,group_name,kind,old_instance_id,new_instance_id,message) VALUES(route->>'base',a.group_name_snapshot,'send_offline',(route->>'instance_id')::uuid,(route->>'instance_id')::uuid,coalesce(route->>'label','Instância')||' desconectada — grupo aguardando'); END IF;
 END IF;
 END LOOP;
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.refresh_group_admin_send_routes(int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_group_admin_send_routes(int) TO service_role;