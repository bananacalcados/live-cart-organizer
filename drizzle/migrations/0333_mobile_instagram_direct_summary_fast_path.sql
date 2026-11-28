DO $fix$
DECLARE definition text; old_section text; new_section text; filters text;
BEGIN
 SELECT pg_get_functiondef('public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)'::regprocedure) INTO definition;
 old_section:=substring(definition FROM position('SELECT hydrated.* FROM public.whatsapp_conversations c' IN definition) FOR position('), all_sources AS (' IN definition)-position('SELECT hydrated.* FROM public.whatsapp_conversations c' IN definition));
 IF old_section IS NULL OR position('CROSS JOIN LATERAL jsonb_populate_record' IN old_section)=0 THEN RAISE EXCEPTION 'Mobile Direct read differs; nothing applied'; END IF;
 filters:=$filters$
 AND (v_ids IS NULL OR c.whatsapp_number_id=ANY(v_ids) OR (cardinality(v_ids)>1 AND v_legacy AND c.whatsapp_number_id IS NULL))
 AND (p_number_id IS NULL OR c.whatsapp_number_id=p_number_id)
 AND (NOT c.is_group OR public.wa_group_chat_state(c.phone,c.whatsapp_number_id)='normal')
 AND (length(btrim(p_query))>=3 OR p_lane IN ('archived','finished') OR c.last_message_at>now()-interval '14 days')
 $filters$;
 new_section:='SELECT c.* FROM public.whatsapp_conversations c WHERE c.channel IS DISTINCT FROM ''instagram'''||filters||$select$
 UNION ALL
 SELECT hydrated.* FROM ig_latest d JOIN public.whatsapp_conversations c ON c.phone=d.phone AND c.instance_key=coalesce(d.whatsapp_number_id,'00000000-0000-0000-0000-000000000000'::uuid)
 CROSS JOIN LATERAL jsonb_populate_record(NULL::public.whatsapp_conversations,to_jsonb(c)||jsonb_build_object('last_message',d.message,'nm_last_message',d.message,'last_message_at',d.created_at,'nm_last_message_at',d.created_at,'last_direction',d.direction,'nm_last_direction',d.direction,'last_incoming_at',d.incoming_at,'last_outgoing_at',d.outgoing_at,'nm_last_outgoing_at',d.outgoing_at,'sender_name',coalesce(c.sender_name,d.sender_name),'last_is_mass_dispatch',false)) hydrated
 WHERE c.channel='instagram'
 $select$||filters;
 definition:=replace(definition,old_section,new_section);
 EXECUTE definition;
END $fix$;