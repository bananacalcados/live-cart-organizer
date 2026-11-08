CREATE OR REPLACE FUNCTION public.live_event_sender(p_event_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT jsonb_build_object('id',coalesce(e.wa_initial_number_id,wl.whatsapp_number_id,e.whatsapp_number_id),'target_phone',wl.target_phone) FROM events e LEFT JOIN LATERAL(SELECT whatsapp_number_id,target_phone FROM live_whatsapp_links WHERE event_id=e.id ORDER BY is_active DESC LIMIT 1) wl ON true WHERE e.id=p_event_id $$;
REVOKE ALL ON FUNCTION public.live_event_sender(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.live_event_sender(uuid) TO service_role;
CREATE TABLE public.whatsapp_lid_phone_map (whatsapp_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id),lid text NOT NULL,phone_key text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(whatsapp_number_id,lid),CHECK(lid ~ '^[0-9]{14,20}$'),CHECK(length(phone_key)=10));
GRANT ALL ON public.whatsapp_lid_phone_map TO service_role;
ALTER TABLE public.whatsapp_lid_phone_map ENABLE ROW LEVEL SECURITY;
CREATE INDEX whatsapp_lid_phone_map_reverse ON public.whatsapp_lid_phone_map(whatsapp_number_id,phone_key,lid);
CREATE OR REPLACE FUNCTION public.live_followup_contact_aliases(p_phone text,p_number uuid,p_ig_id text DEFAULT NULL) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT array_remove(array_agg(DISTINCT alias),NULL) FROM (SELECT unnest(ARRAY[p_phone,p_phone||'@s.whatsapp.net',substring(p_phone from 3),substring(p_phone from 1 for 4)||substring(p_phone from 6),p_ig_id]) alias UNION ALL SELECT unnest(ARRAY[lid,lid||'@lid']) FROM whatsapp_lid_phone_map WHERE whatsapp_number_id=p_number AND phone_key=automation_phone_key(p_phone)) a $$;
REVOKE ALL ON FUNCTION public.live_followup_contact_aliases(text,uuid,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.live_followup_contact_aliases(text,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.instagram_reply_context(p_username text,p_event_id uuid DEFAULT NULL,p_number_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE handle text:=lower(trim(both '@ ' from p_username)); igid text; nid uuid:=p_number_id; inbound timestamptz; ids text[]; liveids text[]; expires timestamptz; active boolean:=false;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' AND NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'chat') OR has_module_access(auth.uid(),'pos') OR has_module_access(auth.uid(),'events') OR has_module_access(auth.uid(),'marketing') OR has_module_access(auth.uid(),'expedition')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT ig_user_id INTO igid FROM instagram_user_links WHERE lower(username)=handle LIMIT 1;
 IF nid IS NULL THEN SELECT m.whatsapp_number_id INTO nid FROM whatsapp_messages m WHERE m.phone=igid AND m.channel='instagram' AND m.whatsapp_number_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1; END IF;
 IF nid IS NULL THEN SELECT m.whatsapp_number_id INTO nid FROM live_comments lc JOIN whatsapp_messages m ON m.message_id=lc.comment_id AND m.channel='instagram' WHERE lower(regexp_replace(lc.username,'^@',''))=handle AND (p_event_id IS NULL OR lc.event_id=p_event_id) ORDER BY lc.created_at DESC LIMIT 1; END IF;
 SELECT max(m.created_at) INTO inbound FROM whatsapp_messages m WHERE m.phone=igid AND m.channel='instagram' AND m.direction='incoming' AND (nid IS NULL OR m.whatsapp_number_id=nid) AND m.created_at>now()-interval '24 hours' AND coalesce(m.message,'') NOT LIKE '💬 Comentário%' AND NOT EXISTS(SELECT 1 FROM live_comments lc WHERE lc.comment_id=m.message_id) AND NOT EXISTS(SELECT 1 FROM ig_comment_moderation cm WHERE cm.comment_id=m.message_id);
 SELECT coalesce(bool_or(e.is_live_broadcasting AND e.live_active_until>now()),false) INTO active FROM events e WHERE e.id=p_event_id;
 WITH candidates AS (
 SELECT lc.comment_id,lc.created_at,lc.source_pc,CASE WHEN lc.source_pc IN ('meta-webhook-live','meta-live-media-sync') THEN e.live_active_until ELSE lc.created_at+interval '7 days' END until_at,
 CASE WHEN lc.source_pc IN ('meta-webhook-live','meta-live-media-sync') THEN coalesce(e.is_live_broadcasting AND e.live_active_until>now(),false) WHEN lc.source_pc='meta-webhook' THEN lc.created_at>now()-interval '7 days' ELSE false END eligible
 FROM live_comments lc JOIN events e ON e.id=lc.event_id WHERE lower(regexp_replace(lc.username,'^@',''))=handle AND (p_event_id IS NULL OR lc.event_id=p_event_id) AND lc.created_at>now()-interval '7 days'
 AND (nid IS NULL OR EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.message_id=lc.comment_id AND m.whatsapp_number_id=nid AND m.channel='instagram'))
 AND NOT EXISTS(SELECT 1 FROM live_comment_dms d WHERE d.comment_id=lc.comment_id AND d.status IN ('sent','processing','uncertain'))
 AND NOT EXISTS(SELECT 1 FROM instagram_comment_actions a WHERE a.comment_id=lc.comment_id AND a.action_type IN ('dm','private_reply') AND a.status IN ('sent','processing','pending'))
 AND NOT EXISTS(SELECT 1 FROM ig_comment_moderation cm WHERE cm.comment_id=lc.comment_id AND cm.private_reply_sent_at IS NOT NULL)
 ORDER BY lc.created_at DESC,lc.comment_id DESC LIMIT 50)
 SELECT array_agg(comment_id ORDER BY created_at DESC,comment_id DESC) FILTER(WHERE eligible),array_agg(comment_id ORDER BY created_at DESC) FILTER(WHERE source_pc IN ('meta-webhook-live','meta-live-media-sync')),max(until_at) FILTER(WHERE eligible) INTO ids,liveids,expires FROM candidates;
 RETURN jsonb_build_object('window_open',inbound IS NOT NULL,'window_until',inbound+interval '24 hours','comment_ids',coalesce(ids,ARRAY[]::text[]),'live_comment_ids',coalesce(liveids,ARRAY[]::text[]),'private_until',expires,'live_active',active,'number_id',nid);
END $$;
REVOKE ALL ON FUNCTION public.instagram_reply_context(text,uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.instagram_reply_context(text,uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.instagram_private_reply_claim(p_comment_id text,p_username text,p_event_id uuid,p_number_id uuid,p_message text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE ctx jsonb; eid uuid; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ig-private:'||p_comment_id,0));
 ctx:=instagram_reply_context(p_username,p_event_id,p_number_id);
 IF NOT (ctx->'comment_ids' ? p_comment_id) THEN RETURN false; END IF;
 SELECT event_id INTO eid FROM live_comments WHERE comment_id=p_comment_id ORDER BY created_at DESC LIMIT 1;
 INSERT INTO live_comment_dms(event_id,comment_id,username,message,status) VALUES(eid,p_comment_id,lower(trim(both '@ ' from p_username)),p_message,'processing'); RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.instagram_private_reply_claim(text,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.instagram_private_reply_claim(text,text,uuid,uuid,text) TO service_role;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.live_followup_source_contexts(integer)'::regprocedure) INTO def;
 def:=replace(def,'''whatsapp_number_id'',e.whatsapp_number_id','''whatsapp_number_id'',(public.live_event_sender(e.id)->>''id'')::uuid,''wa_initial_number_id'',e.wa_initial_number_id');
 def:=replace(def,'''ig_instance_id'',ig.whatsapp_number_id','''ig_instance_id'',coalesce(ig.whatsapp_number_id,(public.instagram_reply_context(coalesce(a.instagram,c.instagram_handle),e.id,NULL)->>''number_id'')::uuid)'); EXECUTE def;
 SELECT pg_get_functiondef('public.live_followup_job_context(uuid)'::regprocedure) INTO def;
 def:=replace(def,'''whatsapp_number_id'',e.whatsapp_number_id','''whatsapp_number_id'',(public.live_event_sender(e.id)->>''id'')::uuid,''wa_initial_number_id'',e.wa_initial_number_id');
 def:=replace(def,'m.phone IN (j.phone,j.phone||''@s.whatsapp.net'',substring(j.phone from 3),substring(j.phone from 1 for 4)||substring(j.phone from 6),l.ig_user_id)','m.phone = ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,l.ig_user_id))');
 def:=replace(def,'''window_open'',EXISTS','''instagram_context'',CASE WHEN j.channel=''instagram'' THEN public.instagram_reply_context(j.instagram,j.event_id,j.whatsapp_number_id) ELSE NULL END,''window_open'',EXISTS');
 def:=replace(def,'m.created_at>now()-interval ''24 hours''))','m.created_at>now()-interval ''24 hours'' AND (j.channel<>''instagram'' OR (coalesce(m.message,'''') NOT LIKE ''💬 Comentário%'' AND NOT EXISTS(SELECT 1 FROM live_comments lc WHERE lc.comment_id=m.message_id)))))');
 EXECUTE def;
 SELECT pg_get_functiondef('public.live_followup_mark_manual_cart(uuid,text,uuid)'::regprocedure) INTO def;
 def:=replace(def,'e.whatsapp_number_id=p_number_id','(public.live_event_sender(e.id)->>''id'')::uuid=p_number_id'); EXECUTE def;
END $$;