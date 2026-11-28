CREATE OR REPLACE FUNCTION public.mobile_instagram_is_direct(p_message text,p_source text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT coalesce(p_message,'') NOT LIKE '💬 Comentário%' AND coalesce(p_source,'') NOT IN ('ig_comment','instagram_comment','live_comment');
$fn$;
REVOKE ALL ON FUNCTION public.mobile_instagram_is_direct(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mobile_instagram_is_direct(text,text) TO authenticated,service_role;

DO $fix$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)'::regprocedure) INTO definition;
 IF position('), summaries AS (' IN definition)=0 OR position('SELECT c.* FROM public.whatsapp_conversations c' IN definition)=0 THEN RAISE EXCEPTION 'Mobile read definition differs; no changes applied'; END IF;
 definition:=replace(definition,'), summaries AS (',$insert$), ig_history_candidates AS MATERIALIZED (
 SELECT c.phone,c.whatsapp_number_id FROM public.whatsapp_conversations c
 LEFT JOIN public.chat_contacts cc ON cc.phone=c.phone
 WHERE c.channel='instagram'
 AND (v_ids IS NULL OR c.whatsapp_number_id=ANY(v_ids)) AND (p_number_id IS NULL OR c.whatsapp_number_id=p_number_id)
 AND ((p_lane='archived' AND EXISTS(SELECT 1 FROM public.chat_archived_conversations a WHERE a.phone=c.phone))
 OR (p_lane='finished' AND EXISTS(SELECT 1 FROM public.chat_finished_conversations f WHERE f.phone=c.phone AND f.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id))
 OR (length(btrim(p_query))>=3 AND (strpos(lower(coalesce(cc.custom_name,cc.display_name,c.sender_name,'')),lower(btrim(p_query)))>0
 OR (regexp_replace(p_query,'\D','','g')<>'' AND c.phone ILIKE '%'||regexp_replace(p_query,'\D','','g')||'%')
 OR EXISTS(SELECT 1 FROM public.customers_unified u WHERE u.phone_suffix8=right(c.phone,8) AND u.merged_into_id IS NULL AND strpos(lower(u.name),lower(btrim(p_query)))>0))))
), ig_messages AS MATERIALIZED (
 SELECT m.id,m.phone,m.whatsapp_number_id,m.message,m.created_at,m.direction,m.sender_name FROM public.whatsapp_messages m
 WHERE m.channel='instagram' AND m.created_at>now()-interval '14 days'
 AND (v_ids IS NULL OR m.whatsapp_number_id=ANY(v_ids)) AND (p_number_id IS NULL OR m.whatsapp_number_id=p_number_id)
 AND public.mobile_instagram_is_direct(m.message,m.source)
 UNION
 SELECT m.id,m.phone,m.whatsapp_number_id,m.message,m.created_at,m.direction,m.sender_name FROM ig_history_candidates c
 JOIN public.whatsapp_messages m ON m.phone=c.phone AND m.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id
 WHERE m.channel='instagram' AND public.mobile_instagram_is_direct(m.message,m.source)
 UNION
 SELECT m.id,m.phone,m.whatsapp_number_id,m.message,m.created_at,m.direction,m.sender_name FROM ig_history_candidates c
 JOIN public.whatsapp_messages_archive m ON m.phone=c.phone AND m.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id
 WHERE m.channel='instagram' AND public.mobile_instagram_is_direct(m.message,m.source)
), ig_latest AS (
 SELECT DISTINCT ON (phone,whatsapp_number_id) *,
 max(created_at) FILTER(WHERE direction='incoming') OVER(PARTITION BY phone,whatsapp_number_id) AS incoming_at,
 max(created_at) FILTER(WHERE direction='outgoing') OVER(PARTITION BY phone,whatsapp_number_id) AS outgoing_at
 FROM ig_messages ORDER BY phone,whatsapp_number_id,created_at DESC,id DESC
), summaries AS ($insert$);
 definition:=replace(definition,'SELECT c.* FROM public.whatsapp_conversations c',$select$SELECT hydrated.* FROM public.whatsapp_conversations c
 LEFT JOIN ig_latest d ON d.phone=c.phone AND d.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id
 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.whatsapp_conversations,
 CASE WHEN c.channel='instagram' THEN to_jsonb(c)||jsonb_build_object('last_message',d.message,'nm_last_message',d.message,'last_message_at',d.created_at,'nm_last_message_at',d.created_at,'last_direction',d.direction,'nm_last_direction',d.direction,'last_incoming_at',d.incoming_at,'last_outgoing_at',d.outgoing_at,'nm_last_outgoing_at',d.outgoing_at,'sender_name',coalesce(c.sender_name,d.sender_name),'last_is_mass_dispatch',false) ELSE to_jsonb(c) END) hydrated$select$);
 definition:=replace(definition,'WHERE (v_ids IS NULL OR c.whatsapp_number_id=ANY(v_ids)', 'WHERE (c.channel IS DISTINCT FROM ''instagram'' OR d.phone IS NOT NULL) AND (v_ids IS NULL OR c.whatsapp_number_id=ANY(v_ids)');
 definition:=replace(definition,'''unread_count'',unread_count,',$unread$'unread_count',CASE WHEN e.channel='instagram' THEN
 (SELECT count(*) FROM public.whatsapp_messages m WHERE m.phone=e.phone AND m.whatsapp_number_id IS NOT DISTINCT FROM e.whatsapp_number_id AND m.channel='instagram' AND m.direction='incoming' AND coalesce(m.status,'')<>'read' AND public.mobile_instagram_is_direct(m.message,m.source))
 +(SELECT count(*) FROM public.whatsapp_messages_archive m WHERE m.phone=e.phone AND m.whatsapp_number_id IS NOT DISTINCT FROM e.whatsapp_number_id AND m.channel='instagram' AND m.direction='incoming' AND coalesce(m.status,'')<>'read' AND public.mobile_instagram_is_direct(m.message,m.source))
 ELSE e.unread_count END,$unread$);
 definition:=replace(definition,'INTO v_rows FROM filtered;','INTO v_rows FROM filtered e;');
 EXECUTE definition;
END $fix$;

CREATE OR REPLACE FUNCTION public.mobile_instagram_message_page(p_phone text,p_number_id uuid DEFAULT NULL,p_archive boolean DEFAULT false,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_after_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_ids uuid[] DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_team_member(auth.uid()) OR NOT public.has_module_access(auth.uid(),'pos') THEN RAISE EXCEPTION 'Sem acesso ao PDV'; END IF;
 IF cardinality(p_ids)>100 THEN RAISE EXCEPTION 'Limite de mensagens excedido'; END IF;
 IF p_archive THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'phone',m.phone,'message',m.message,'direction',m.direction,'created_at',m.created_at,'media_type',m.media_type,'media_url',m.media_url,'status',m.status,'is_group',m.is_group,'whatsapp_number_id',m.whatsapp_number_id,'sender_name',m.sender_name,'message_id',m.message_id,'sender_user_id',m.sender_user_id,'quoted_message_id',m.quoted_message_id,'sender_phone',to_jsonb(m)->'sender_phone','template_payload',to_jsonb(m)->'template_payload') ORDER BY m.created_at,m.id),'[]'::jsonb) INTO result
 FROM (SELECT m.* FROM public.whatsapp_messages_archive m WHERE m.phone=p_phone AND m.whatsapp_number_id IS NOT DISTINCT FROM p_number_id AND m.channel='instagram' AND public.mobile_instagram_is_direct(m.message,m.source)
 AND (p_before_at IS NULL OR (m.created_at,m.id)<(p_before_at,p_before_id)) AND (p_after_at IS NULL OR (m.created_at,m.id)>(p_after_at,p_after_id)) AND (p_ids IS NULL OR m.id=ANY(p_ids))
 ORDER BY CASE WHEN p_after_at IS NOT NULL THEN m.created_at END ASC,CASE WHEN p_after_at IS NOT NULL THEN m.id END ASC,CASE WHEN p_after_at IS NULL THEN m.created_at END DESC,CASE WHEN p_after_at IS NULL THEN m.id END DESC LIMIT greatest(1,least(coalesce(p_limit,50),100)))m;
 ELSE
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'phone',m.phone,'message',m.message,'direction',m.direction,'created_at',m.created_at,'media_type',m.media_type,'media_url',m.media_url,'status',m.status,'is_group',m.is_group,'whatsapp_number_id',m.whatsapp_number_id,'sender_name',m.sender_name,'message_id',m.message_id,'sender_user_id',m.sender_user_id,'quoted_message_id',m.quoted_message_id,'sender_phone',to_jsonb(m)->'sender_phone','template_payload',to_jsonb(m)->'template_payload') ORDER BY m.created_at,m.id),'[]'::jsonb) INTO result
 FROM (SELECT m.* FROM public.whatsapp_messages m WHERE m.phone=p_phone AND m.whatsapp_number_id IS NOT DISTINCT FROM p_number_id AND m.channel='instagram' AND public.mobile_instagram_is_direct(m.message,m.source)
 AND (p_before_at IS NULL OR (m.created_at,m.id)<(p_before_at,p_before_id)) AND (p_after_at IS NULL OR (m.created_at,m.id)>(p_after_at,p_after_id)) AND (p_ids IS NULL OR m.id=ANY(p_ids))
 ORDER BY CASE WHEN p_after_at IS NOT NULL THEN m.created_at END ASC,CASE WHEN p_after_at IS NOT NULL THEN m.id END ASC,CASE WHEN p_after_at IS NULL THEN m.created_at END DESC,CASE WHEN p_after_at IS NULL THEN m.id END DESC LIMIT greatest(1,least(coalesce(p_limit,50),100)))m;
 END IF;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.mobile_instagram_message_page(text,uuid,boolean,timestamptz,uuid,timestamptz,uuid,uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mobile_instagram_message_page(text,uuid,boolean,timestamptz,uuid,timestamptz,uuid,uuid[],integer) TO authenticated,service_role;