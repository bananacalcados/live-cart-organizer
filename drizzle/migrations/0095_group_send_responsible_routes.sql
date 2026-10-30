ALTER TABLE public.group_campaign_scheduled_messages ADD COLUMN IF NOT EXISTS group_instance_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.group_admin_actions ADD COLUMN IF NOT EXISTS fallback_number_id uuid;
ALTER TABLE public.group_admin_actions ADD COLUMN IF NOT EXISTS override_number_id uuid;
ALTER TABLE public.group_campaign_block_dispatches ADD COLUMN IF NOT EXISTS fallback_number_id uuid;
ALTER TABLE public.group_campaign_block_dispatches ADD COLUMN IF NOT EXISTS override_number_id uuid;
ALTER TABLE public.group_campaign_block_dispatches ADD COLUMN IF NOT EXISTS routing_source text;
ALTER TABLE public.group_campaign_block_dispatches ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.group_campaign_block_dispatches ADD COLUMN IF NOT EXISTS provider_message_id text;
CREATE OR REPLACE FUNCTION public.group_send_responsible_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce((SELECT value <> 'false'::jsonb FROM app_settings WHERE key='group_send_via_responsible' ORDER BY updated_at DESC LIMIT 1),true) $$;
CREATE OR REPLACE FUNCTION public.resolve_group_send_route(p_jid text,p_fallback uuid DEFAULT NULL,p_override uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE b text:=split_part(split_part(p_jid,'@',1),'-',1); r whatsapp_group_responsible; n whatsapp_numbers; g whatsapp_groups; wid uuid; src text; adm boolean;
BEGIN
 SELECT * INTO r FROM whatsapp_group_responsible WHERE group_jid_base=b;
 IF NOT group_send_responsible_enabled() THEN wid:=p_fallback; src:='legacy';
 ELSIF p_override IS NOT NULL THEN wid:=p_override; src:='override';
 ELSIF r.instance_id IS NOT NULL THEN wid:=r.instance_id; src:='responsible';
 ELSE wid:=p_fallback; src:='fallback'; END IF;
 SELECT * INTO n FROM whatsapp_numbers WHERE id=wid;
 SELECT * INTO g FROM whatsapp_groups WHERE group_jid_base=b AND is_active AND (instance_id=wid::text OR instance_id=n.zapi_instance_id OR instance_id=n.uazapi_instance_name) ORDER BY (group_id LIKE '%@g.us') DESC,last_synced_at DESC NULLS LAST,id LIMIT 1;
 SELECT is_admin INTO adm FROM group_instance_presence(b) WHERE instance_id=wid AND present;
 RETURN jsonb_build_object('base',b,'instance_id',wid,'label',n.label,'provider',n.provider,'online',coalesce(n.is_active,false) AND n.is_online IS DISTINCT FROM false,'present',g.id IS NOT NULL,'is_admin',coalesce(adm,false),'group_db_id',g.id,'group_jid',coalesce(g.group_id,p_jid),'group_name',g.name,'source',src,'responsible_id',r.instance_id,'responsible_label',(SELECT label FROM whatsapp_numbers WHERE id=r.instance_id));
END $$;
CREATE OR REPLACE FUNCTION public.group_send_routes(p_group_ids uuid[],p_fallback uuid DEFAULT NULL,p_overrides jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'não autenticado'; END IF;
 IF cardinality(p_group_ids)>200 THEN RAISE EXCEPTION 'máximo de 200 grupos por lote'; END IF;
 WITH groups AS (SELECT DISTINCT ON(group_jid_base) id,group_id,group_jid_base,name FROM whatsapp_groups WHERE id=ANY(p_group_ids) ORDER BY group_jid_base,is_active DESC,(group_id LIKE '%@g.us') DESC,id)
 SELECT coalesce(jsonb_agg(resolve_group_send_route(g.group_id,p_fallback,NULLIF(p_overrides->>g.group_jid_base,'')::uuid)||jsonb_build_object('target_id',g.id,'name',g.name)),'[]'::jsonb) INTO v FROM groups g;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.trg_group_admin_send_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE route jsonb;
BEGIN
 NEW.fallback_number_id:=coalesce(NEW.fallback_number_id,NEW.whatsapp_number_id);
 route:=resolve_group_send_route(NEW.group_jid,NEW.fallback_number_id,NEW.override_number_id);
 NEW.whatsapp_number_id:=coalesce((route->>'instance_id')::uuid,NEW.whatsapp_number_id);
 IF group_send_responsible_enabled() AND NOT coalesce((route->>'is_admin')::boolean,false) THEN
 NEW.status:='failed'; NEW.error_message:='instância responsável não é admin'; NEW.finished_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_group_admin_send_route BEFORE INSERT ON public.group_admin_actions FOR EACH ROW EXECUTE FUNCTION public.trg_group_admin_send_route();
CREATE TABLE public.group_send_leases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),group_jid_base text NOT NULL,whatsapp_number_id uuid NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,expires_at timestamptz NOT NULL DEFAULT now()+interval '120 seconds',outcome text,provider_message_id text);
GRANT ALL ON public.group_send_leases TO service_role;
GRANT SELECT ON public.group_send_leases TO authenticated;
ALTER TABLE public.group_send_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read group send history" ON public.group_send_leases FOR SELECT TO authenticated USING(auth.uid() IS NOT NULL);
CREATE INDEX group_send_leases_active ON public.group_send_leases(group_jid_base,expires_at) WHERE finished_at IS NULL;
CREATE OR REPLACE FUNCTION public.group_send_in_progress(p_base text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM group_admin_actions a WHERE a.status IN ('pending','processing','running','sending','queued','claimed','in_progress') AND split_part(split_part(a.group_jid,'@',1),'-',1)=p_base)
 OR EXISTS(SELECT 1 FROM group_campaign_block_dispatches d WHERE d.status IN ('pending','processing','running','sending','queued','claimed','in_progress') AND split_part(split_part(d.group_zapi_id,'@',1),'-',1)=p_base)
 OR EXISTS(SELECT 1 FROM group_send_leases l WHERE l.group_jid_base=p_base AND l.finished_at IS NULL AND l.expires_at>now()) $$;
CREATE OR REPLACE FUNCTION public.reserve_direct_group_send(p_jid text,p_fallback uuid DEFAULT NULL,p_override uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text:=split_part(split_part(p_jid,'@',1),'-',1); route jsonb; v_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('group-send:'||b,0));
 PERFORM 1 FROM whatsapp_group_responsible WHERE group_jid_base=b FOR UPDATE;
 route:=resolve_group_send_route(p_jid,p_fallback,p_override);
 IF route->>'instance_id' IS NULL THEN RAISE EXCEPTION 'grupo sem responsável e sem instância informada'; END IF;
 IF NOT (route->>'online')::boolean THEN RAISE EXCEPTION '% desconectada — grupo aguardando',route->>'label'; END IF;
 IF NOT (route->>'present')::boolean THEN RAISE EXCEPTION 'instância não participa do grupo'; END IF;
 INSERT INTO group_send_leases(group_jid_base,whatsapp_number_id) VALUES(b,(route->>'instance_id')::uuid) RETURNING id INTO v_id;
 RETURN route||jsonb_build_object('lease_id',v_id);
END $$;
CREATE OR REPLACE FUNCTION public.finish_direct_group_send(p_id uuid,p_outcome text,p_message_id text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text;
BEGIN
 UPDATE group_send_leases SET finished_at=now(),outcome=p_outcome,provider_message_id=p_message_id WHERE id=p_id AND finished_at IS NULL RETURNING group_jid_base INTO b;
 IF b IS NOT NULL THEN PERFORM recompute_group_responsible(b); END IF;
END $$;
REVOKE ALL ON FUNCTION public.group_send_responsible_enabled(),public.resolve_group_send_route(text,uuid,uuid),public.trg_group_admin_send_route(),public.reserve_direct_group_send(text,uuid,uuid),public.finish_direct_group_send(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.group_send_responsible_enabled(),public.resolve_group_send_route(text,uuid,uuid),public.trg_group_admin_send_route(),public.reserve_direct_group_send(text,uuid,uuid),public.finish_direct_group_send(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.group_send_routes(uuid[],uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.group_send_routes(uuid[],uuid,jsonb) TO authenticated,service_role;