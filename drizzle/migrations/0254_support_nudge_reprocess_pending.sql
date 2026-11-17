CREATE OR REPLACE FUNCTION public.support_is_nudge(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(btrim(coalesce(p_text,''))) ~ '^(\?+|!+|oi+\s*\?+|ol[aá]\s*\?+|al(gu|g)[eé]m\s*(a[ií])?\s*\?*|cad[eê]\s*\?*|e\s*a[ií]\s*\?*|e\s*ent[aã]o\s*\?*|bom\s+dia\s*\?+|boa\s+(tarde|noite)\s*\?+|\.+)$'
$$;
REVOKE ALL ON FUNCTION public.support_is_nudge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_is_nudge(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_ai_enqueue(p_message_row_id uuid, p_phone text, p_number_id uuid, p_channel text, p_text text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE st public.support_settings%ROWTYPE; v_id uuid; k text; old public.support_auto_suggestions%ROWTYPE; prev public.support_auto_suggestions%ROWTYPE;
BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1;
 IF st.auto_reply_mode NOT IN ('shadow','auto') OR p_number_id IS NULL OR NOT(p_number_id=ANY(st.auto_reply_instance_ids)) THEN RETURN NULL; END IF;
 k:=CASE WHEN coalesce(p_channel,'whatsapp')='whatsapp' THEN 'wa:'||right(regexp_replace(p_phone,'\D','','g'),8) ELSE 'ig:'||p_phone END;
 -- Cobrança curta ("?", "oi?", "cadê?"): reprocessa a pendência parada com a regra atual.
 IF public.support_is_nudge(p_text) AND NOT public.support_cost_human(p_phone,p_channel) THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('support_cost:'||k,0));
   SELECT * INTO prev FROM public.support_auto_suggestions
    WHERE cost_key=k AND whatsapp_number_id=p_number_id AND status='nova' AND created_at>now()-interval '48 hours'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
   IF FOUND AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_messages m
        WHERE m.phone=p_phone AND m.whatsapp_number_id=p_number_id AND m.direction='outgoing' AND m.created_at>prev.created_at) THEN
     UPDATE public.support_auto_suggestions SET status='substituida' WHERE id=prev.id;
     INSERT INTO public.support_auto_suggestions(message_row_id,whatsapp_number_id,channel,phone,incoming_text,intent,decision,reason,mode_at_creation,ai_status,status,cost_key,cost_due_at)
     VALUES(p_message_row_id,p_number_id,coalesce(p_channel,'whatsapp'),p_phone,left(coalesce(prev.incoming_text,'')||E'\n'||p_text,4000),coalesce(prev.intent,'indefinido'),'fila','aguardando_ia',st.auto_reply_mode,'pendente','processando',k,now()+CASE WHEN st.ai_silence_queue_enabled THEN interval '2 minutes' ELSE interval '0' END)
     ON CONFLICT(message_row_id) DO NOTHING RETURNING id INTO v_id;
     IF v_id IS NOT NULL AND NOT st.ai_silence_queue_enabled THEN PERFORM net.http_post(url:='https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/support-ai-agent',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT value FROM public.internal_function_secrets WHERE key='cron_secret')),body:=jsonb_build_object('suggestion_id',v_id),timeout_milliseconds:=60000); END IF;
     RETURN v_id;
   END IF;
 END IF;
 IF coalesce(p_text,'') !~ '[[:alnum:]]' OR public.support_cost_human(p_phone,p_channel) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('support_cost:'||k,0));
 SELECT * INTO old FROM public.support_auto_suggestions WHERE cost_key=k AND status='processando' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND AND old.created_at>now()-interval '5 minutes' THEN
   IF st.ai_silence_queue_enabled AND old.cost_claimed_at IS NULL THEN UPDATE public.support_auto_suggestions SET incoming_text=left(coalesce(incoming_text,'')||E'\n'||p_text,4000),message_row_id=p_message_row_id,phone=p_phone,whatsapp_number_id=p_number_id,cost_due_at=now()+interval '2 minutes' WHERE id=old.id; END IF;
   RETURN old.id;
 END IF;
 IF NOT public.support_cost_keywords(p_text) AND NOT public.support_cost_recent_order(p_phone) THEN RETURN NULL; END IF;
 INSERT INTO public.support_auto_suggestions(message_row_id,whatsapp_number_id,channel,phone,incoming_text,intent,decision,reason,mode_at_creation,ai_status,status,cost_key,cost_due_at)
 VALUES(p_message_row_id,p_number_id,coalesce(p_channel,'whatsapp'),p_phone,left(p_text,4000),coalesce(public.support_classify_intent(p_text),'indefinido'),'fila','aguardando_ia',st.auto_reply_mode,'pendente','processando',k,now()+CASE WHEN st.ai_silence_queue_enabled THEN interval '2 minutes' ELSE interval '0' END) ON CONFLICT(message_row_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL AND NOT st.ai_silence_queue_enabled THEN PERFORM net.http_post(url:='https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/support-ai-agent',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT value FROM public.internal_function_secrets WHERE key='cron_secret')),body:=jsonb_build_object('suggestion_id',v_id),timeout_milliseconds:=60000); END IF;
 RETURN v_id;
END
$function$;