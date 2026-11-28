CREATE INDEX IF NOT EXISTS idx_support_tickets_open_phone_suffix8 ON public.support_tickets ((right(regexp_replace(coalesce(customer_phone,''),'\D','','g'),8))) WHERE status <> 'resolved';
CREATE OR REPLACE FUNCTION public.mobile_whatsapp_page(p_store_id uuid, p_seller_id uuid DEFAULT NULL, p_query text DEFAULT '', p_number_id uuid DEFAULT NULL, p_lane text DEFAULT 'all', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v_ids uuid[]; v_legacy boolean; v_viewer uuid; v_admin boolean; v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_team_member(auth.uid()) OR NOT public.has_module_access(auth.uid(),'pos') THEN RAISE EXCEPTION 'Sem acesso ao PDV'; END IF;
 SELECT array_agg(n.whatsapp_number_id), bool_or(w.provider='zapi') INTO v_ids,v_legacy FROM public.pos_store_whatsapp_numbers n JOIN public.whatsapp_numbers_safe w ON w.id=n.whatsapp_number_id WHERE n.store_id=p_store_id;
 SELECT coalesce(s.linked_user_id,s.id) INTO v_viewer FROM public.pos_sellers s WHERE s.id=p_seller_id AND s.store_id=p_store_id AND s.is_active;
 SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role::text IN ('admin','moderator')) INTO v_admin;
 WITH active_events AS MATERIALIZED (
 SELECT e.id,e.whatsapp_number_id FROM public.events e WHERE e.is_active AND (v_ids IS NULL OR e.default_store_id=p_store_id OR e.whatsapp_number_id=ANY(v_ids))
 ), live_phones AS MATERIALIZED (
 SELECT DISTINCT ON (right(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),8))
 right(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),8) AS phone_key,
 CASE WHEN regexp_replace(c.whatsapp,'\D','','g') LIKE '55%' THEN regexp_replace(c.whatsapp,'\D','','g') ELSE '55'||regexp_replace(c.whatsapp,'\D','','g') END AS phone,
 c.instagram_handle AS name,o.updated_at, e.whatsapp_number_id
 FROM active_events e JOIN public.orders o ON o.event_id=e.id JOIN public.customers c ON c.id=o.customer_id
 WHERE length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g')) BETWEEN 8 AND 13
 ORDER BY right(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),8),o.is_paid,o.created_at DESC
 ), summaries AS (
 SELECT c.* FROM public.whatsapp_conversations c
 WHERE (v_ids IS NULL OR c.whatsapp_number_id=ANY(v_ids) OR (cardinality(v_ids)>1 AND v_legacy AND c.whatsapp_number_id IS NULL))
 AND (p_number_id IS NULL OR c.whatsapp_number_id=p_number_id)
 AND (NOT c.is_group OR public.wa_group_chat_state(c.phone,c.whatsapp_number_id)='normal')
 AND (length(btrim(p_query))>=3 OR p_lane IN ('archived','finished') OR c.last_message_at>now()-interval '14 days')
 ), all_sources AS (
 SELECT s.* FROM summaries s
 UNION ALL
 SELECT ghost.* FROM live_phones l CROSS JOIN LATERAL jsonb_populate_record(NULL::public.whatsapp_conversations,jsonb_build_object('phone',l.phone,'instance_key',coalesce(l.whatsapp_number_id,'00000000-0000-0000-0000-000000000000'::uuid),'whatsapp_number_id',l.whatsapp_number_id,'is_group',false,'channel','whatsapp','sender_name',l.name,'last_message','Pedido da live — sem conversa ainda','last_message_at',l.updated_at,'last_direction','incoming','nm_last_message','Pedido da live — sem conversa ainda','nm_last_message_at',l.updated_at,'nm_last_direction','incoming','unread_count',0,'last_incoming_at',l.updated_at)) ghost
 WHERE (p_lane='live' OR length(btrim(p_query))>=3) AND (p_number_id IS NULL OR l.whatsapp_number_id=p_number_id)
 AND NOT EXISTS (SELECT 1 FROM summaries s WHERE right(s.phone,8)=l.phone_key)
 AND NOT EXISTS (SELECT 1 FROM public.chat_finished_conversations f WHERE right(regexp_replace(f.phone,'[^0-9]','','g'),8)=l.phone_key)
 AND NOT EXISTS (SELECT 1 FROM public.chat_archived_conversations a WHERE a.phone=l.phone)
 ), base AS (
 SELECT c.*,CASE WHEN p_lane='dispatch' THEN c.last_message ELSE c.nm_last_message END AS display_message,
 CASE WHEN p_lane='dispatch' THEN c.last_message_at ELSE c.nm_last_message_at END AS display_at,
 CASE WHEN p_lane='dispatch' THEN c.last_direction ELSE c.nm_last_direction END AS display_direction FROM all_sources c
 ), enriched AS (
 SELECT b.*,coalesce(nullif(cc.custom_name,''),nullif(cc.display_name,''),nullif(cu.name,''),b.sender_name,b.phone) AS customer_name,
 a.assigned_to,a.assigned_name,
 CASE WHEN f.finished_at>=b.display_at THEN 'finished' WHEN b.display_direction='incoming' AND (b.nm_last_outgoing_at IS NULL OR b.nm_last_outgoing_at<now()-interval '14 days') THEN 'not_started' WHEN b.display_direction='incoming' THEN 'awaiting_reply' ELSE 'awaiting_customer' END AS conversation_status,
 ar.phone IS NOT NULL AS archived,pay.phone IS NOT NULL AS awaiting_payment,
 (lp.phone_key IS NOT NULL OR lm.lane='live') AND NOT b.is_group AND NOT coalesce(f.finished_at>=b.display_at,false) AS is_live,
 CASE WHEN lm.lane IS NOT NULL AND lm.lane<>'live' THEN lm.lane WHEN f.finished_at>=b.display_at THEN 'finished' WHEN b.is_group THEN 'groups'
 WHEN EXISTS (SELECT 1 FROM public.support_tickets st WHERE right(regexp_replace(coalesce(st.customer_phone,''),'\D','','g'),8)=right(b.phone,8) AND st.status<>'resolved') THEN 'support'
 WHEN b.display_direction='incoming' AND ((b.nm_last_outgoing_at IS NULL OR b.nm_last_outgoing_at<now()-interval '14 days') OR (f.finished_at IS NOT NULL AND b.display_at>f.finished_at)) THEN 'new'
 WHEN b.display_direction='incoming' THEN 'unread' ELSE 'followup' END AS lane
 FROM base b
 LEFT JOIN live_phones lp ON lp.phone_key=right(b.phone,8)
 LEFT JOIN public.chat_contacts cc ON cc.phone=b.phone
 LEFT JOIN LATERAL (SELECT u.name FROM public.customers_unified u WHERE u.phone_suffix8=right(b.phone,8) AND u.merged_into_id IS NULL ORDER BY u.updated_at DESC LIMIT 1) cu ON NOT b.is_group
 LEFT JOIN public.chat_conversation_assignments a ON a.phone=b.phone AND a.whatsapp_number_id IS NOT DISTINCT FROM b.whatsapp_number_id
 LEFT JOIN LATERAL (SELECT fc.finished_at FROM public.chat_finished_conversations fc WHERE right(regexp_replace(fc.phone,'[^0-9]','','g'),8)=right(b.phone,8) AND (fc.whatsapp_number_id=b.whatsapp_number_id OR fc.whatsapp_number_id IS NULL) ORDER BY fc.finished_at DESC LIMIT 1) f ON true
 LEFT JOIN LATERAL (SELECT m.lane FROM public.chat_conversation_lanes m WHERE m.phone_key=right(b.phone,8) AND m.whatsapp_number_id IN (coalesce(b.whatsapp_number_id::text,''),'') ORDER BY (m.whatsapp_number_id=coalesce(b.whatsapp_number_id::text,'')) DESC LIMIT 1) lm ON true
 LEFT JOIN public.chat_archived_conversations ar ON ar.phone=b.phone
 LEFT JOIN public.chat_awaiting_payment pay ON pay.phone=b.phone
 ), filtered AS (
 SELECT * FROM enriched e WHERE e.display_at IS NOT NULL
 AND (v_admin OR e.assigned_to IS NULL OR e.assigned_to=auth.uid() OR e.assigned_to=v_viewer)
 AND (btrim(p_query)='' OR (length(btrim(p_query))>=3 AND ((e.phone ILIKE '%'||regexp_replace(p_query,'\D','','g')||'%' AND regexp_replace(p_query,'\D','','g')<>'') OR strpos(lower(e.customer_name),lower(btrim(p_query)))>0)))
 AND (CASE WHEN p_lane='archived' THEN e.archived WHEN btrim(p_query)<>'' THEN true ELSE NOT e.archived END)
 AND (p_lane IN ('all','archived','dispatch') OR e.lane=p_lane OR (p_lane='live' AND e.is_live) OR (p_lane='awaiting_payment' AND e.awaiting_payment))
 AND (CASE WHEN p_lane='dispatch' THEN e.last_direction='outgoing' AND (e.last_is_mass_dispatch OR e.last_incoming_at IS NULL OR e.last_incoming_at<now()-interval '14 days') ELSE NOT (e.display_direction='outgoing' AND (e.channel IS NULL OR e.channel NOT IN ('instagram','messenger')) AND (e.last_incoming_at IS NULL OR e.last_incoming_at<now()-interval '14 days')) END)
 ORDER BY CASE WHEN p_lane IN ('new','unread','followup') THEN e.display_at END ASC,CASE WHEN p_lane NOT IN ('new','unread','followup') THEN e.display_at END DESC,e.phone,e.instance_key
 LIMIT greatest(1,least(coalesce(p_limit,50),100)) OFFSET greatest(0,coalesce(p_offset,0))
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('phone',phone,'whatsapp_number_id',whatsapp_number_id,'last_message',display_message,'last_message_at',display_at,'unread_count',unread_count,'direction',display_direction,'customer_name',customer_name,'is_group',is_group,'channel',channel,'lane',lane,'is_live',is_live,'conversation_status',conversation_status,'assigned_to',assigned_to,'assigned_name',assigned_name,'archived',archived,'awaiting_payment',awaiting_payment) ORDER BY CASE WHEN p_lane IN ('new','unread','followup') THEN display_at END ASC,CASE WHEN p_lane NOT IN ('new','unread','followup') THEN display_at END DESC,phone,instance_key),'[]'::jsonb) INTO v_rows FROM filtered;
 RETURN v_rows;
END $fn$;
REVOKE ALL ON FUNCTION public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer) TO authenticated,service_role;