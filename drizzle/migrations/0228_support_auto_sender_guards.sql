ALTER TABLE public.support_outbox
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN suggestion_id uuid REFERENCES public.support_auto_suggestions(id),
  ADD COLUMN link_id uuid REFERENCES public.support_links(id);
CREATE INDEX support_outbox_available_idx ON public.support_outbox(available_at,id) WHERE status='pending' AND claimed_at IS NULL;
CREATE INDEX support_outbox_assistant_instance_idx ON public.support_outbox(whatsapp_number_id,available_at) WHERE requested_by='assistant_auto';

CREATE OR REPLACE FUNCTION public.support_emergency_pause(p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.support_settings SET auto_reply_mode='shadow',ai_pause_reason=left(coalesce(nullif(p_reason,''),'erro_envio_nf_ou_correios'),500),ai_pause_until=NULL,updated_at=now()
  WHERE auto_reply_mode IS DISTINCT FROM 'shadow' OR ai_pause_reason IS DISTINCT FROM left(coalesce(nullif(p_reason,''),'erro_envio_nf_ou_correios'),500);
END $$;
REVOKE ALL ON FUNCTION public.support_emergency_pause(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_emergency_pause(text) TO service_role;

CREATE OR REPLACE FUNCTION public.support_ai_enqueue(p_message_row_id uuid,p_phone text,p_number_id uuid,p_channel text,p_text text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.support_settings%ROWTYPE; v_id uuid; k text; old public.support_auto_suggestions%ROWTYPE;
BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1;
 IF st.auto_reply_mode NOT IN ('shadow','auto') OR p_number_id IS NULL OR NOT(p_number_id=ANY(st.auto_reply_instance_ids)) THEN RETURN NULL; END IF;
 IF coalesce(p_text,'') !~ '[[:alnum:]]' OR public.support_cost_human(p_phone,p_channel) THEN RETURN NULL; END IF;
 k:=CASE WHEN coalesce(p_channel,'whatsapp')='whatsapp' THEN 'wa:'||right(regexp_replace(p_phone,'\D','','g'),8) ELSE 'ig:'||p_phone END;
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
END $$;
REVOKE ALL ON FUNCTION public.support_ai_enqueue(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_ai_enqueue(uuid,text,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.support_cost_worker_claim(p_lease uuid) RETURNS SETOF public.support_auto_suggestions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.support_settings%ROWTYPE; s public.support_auto_suggestions%ROWTYPE; d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1 FOR UPDATE;
 IF st.auto_reply_mode NOT IN ('shadow','auto') OR st.ai_worker_until>now() THEN RETURN; END IF;
 UPDATE public.support_settings SET ai_worker_lease=p_lease,ai_worker_until=now()+interval '5 minutes';
 FOR s IN SELECT * FROM public.support_auto_suggestions WHERE status='processando' AND cost_due_at<=now() AND cost_claimed_at IS NULL ORDER BY cost_due_at,id LIMIT 2 FOR UPDATE SKIP LOCKED LOOP
   IF NOT(s.whatsapp_number_id=ANY(st.auto_reply_instance_ids)) OR public.support_cost_human(s.phone,s.channel) OR (NOT public.support_cost_keywords(s.incoming_text) AND NOT public.support_cost_recent_order(s.phone)) THEN
     UPDATE public.support_auto_suggestions SET status='ignorada',reason='pre_filtro_ao_processar' WHERE id=s.id; CONTINUE;
   END IF;
   UPDATE public.support_auto_suggestions SET cost_claimed_at=now(),cost_prefilter_passed=true,reason='aguardando_ia' WHERE id=s.id;
   INSERT INTO public.support_ai_daily(day,prefiltered) VALUES(d,1) ON CONFLICT(day) DO UPDATE SET prefiltered=support_ai_daily.prefiltered+1;
   RETURN QUERY SELECT * FROM public.support_auto_suggestions WHERE id=s.id;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.support_cost_worker_claim(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_cost_worker_claim(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_suggestion_auto_enqueue(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.support_auto_suggestions%ROWTYPE; st public.support_settings%ROWTYPE; l jsonb; v_text text; v_url text; v_link uuid; v_id uuid; v_last timestamptz; v_base timestamptz; v_delay integer; v_available timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO st FROM public.support_settings WHERE id=true;
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR s.status<>'nova' OR s.mode_at_creation<>'auto' OR st.auto_reply_mode<>'auto' OR NOT(s.whatsapp_number_id=ANY(st.auto_reply_instance_ids)) THEN RETURN jsonb_build_object('queued',false,'reason','modo_ou_status'); END IF;
  IF s.decision NOT IN ('enviar_link','conversa') OR length(trim(coalesce(s.suggested_text,'')))<1 THEN RETURN jsonb_build_object('queued',false,'reason','decisao_sem_envio'); END IF;
  IF s.decision='enviar_link' AND (NOT st.central_public_enabled OR s.sale_id IS NULL OR s.link_type NOT IN ('troca','devolucao')) THEN RETURN jsonb_build_object('queued',false,'reason','central_fechada_ou_sem_pedido'); END IF;
  IF EXISTS(SELECT 1 FROM public.support_outbox o WHERE o.requested_by='assistant_auto' AND o.phone=s.phone AND o.whatsapp_number_id=s.whatsapp_number_id AND (o.status='pending' OR o.status='sent' AND o.sent_at>=now()-interval '24 hours')) THEN RETURN jsonb_build_object('queued',false,'reason','limite_24h_ou_ja_na_fila'); END IF;
  v_text:=trim(s.suggested_text);
  IF s.decision='enviar_link' THEN
    l:=public.create_support_link(s.sale_id::text,s.link_type,'ai',s.phone);
    v_link:=(l->>'id')::uuid;
    v_url:='https://checkout.bananacalcados.com.br/central/'||s.link_type||'/'||(l->>'token');
    v_text:=replace(v_text,'{{link}}',v_url);
  END IF;
  IF v_text ~ '\{\{[^}]+\}\}' OR char_length(v_text)<1 OR char_length(v_text)>1000 THEN RETURN jsonb_build_object('queued',false,'reason','texto_ou_link_invalido'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('support_auto_instance:'||s.whatsapp_number_id::text,0));
  SELECT max(o.available_at) FILTER (WHERE o.status='pending'),max(o.sent_at) FILTER (WHERE o.status='sent') INTO v_last,v_base FROM public.support_outbox o WHERE o.whatsapp_number_id=s.whatsapp_number_id AND o.requested_by='assistant_auto' AND (o.status='pending' OR o.status='sent' AND o.sent_at>=now()-interval '24 hours');
  v_base:=greatest(now(),coalesce(v_last,v_base,now()));
  v_delay:=floor(random()*(greatest(5,least(coalesce(st.auto_reply_max_delay_s,60),300))-greatest(5,least(coalesce(st.auto_reply_min_delay_s,20),300))+1)+greatest(5,least(coalesce(st.auto_reply_min_delay_s,20),300)))::integer;
  v_available:=v_base+make_interval(secs=>v_delay);
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key,available_at,suggestion_id,link_id)
  VALUES(s.phone,s.whatsapp_number_id,v_text,'assistant_auto','assistant-'||s.id::text,v_available,s.id,v_link)
  ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('queued',false,'reason','ja_na_fila'); END IF;
  UPDATE public.support_auto_suggestions SET auto_send_after=v_available,sent_link_id=v_link WHERE id=s.id;
  RETURN jsonb_build_object('queued',true,'outbox_id',v_id,'available_at',v_available,'delay_s',v_delay);
END $$;
REVOKE ALL ON FUNCTION public.support_suggestion_auto_enqueue(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_suggestion_auto_enqueue(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_outbox_claim(p_limit integer DEFAULT 30)
RETURNS SETOF public.support_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_left integer; r public.support_outbox%ROWTYPE; n record; c record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF (SELECT auto_reply_mode FROM public.support_settings WHERE id=true)<>'auto' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(81726351);
  SELECT 30-count(*) INTO v_left FROM public.support_outbox WHERE status='sent' AND sent_at>=now()-interval '1 hour';
  IF v_left<=0 THEN RETURN; END IF;
  FOR r IN SELECT * FROM public.support_outbox
    WHERE status='pending' AND claimed_at IS NULL AND available_at<=now()
      AND whatsapp_number_id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529')
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT least(greatest(coalesce(p_limit,30),1),30,v_left)
  LOOP
    SELECT provider INTO n FROM public.whatsapp_numbers WHERE id=r.whatsapp_number_id AND is_active;
    IF NOT FOUND THEN
      UPDATE public.support_outbox SET status='failed',error='Instância inativa ou não permitida' WHERE id=r.id;
    ELSIF n.provider='meta' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_messages m WHERE m.phone=r.phone AND m.whatsapp_number_id=r.whatsapp_number_id AND m.direction='incoming' AND m.created_at>=now()-interval '24 hours') THEN
      UPDATE public.support_outbox SET status='failed',error='Fora da janela de 24 horas da Meta: é necessária uma mensagem recente da cliente' WHERE id=r.id;
    ELSE
      IF r.suggestion_id IS NOT NULL THEN
        SELECT * INTO c FROM public.whatsapp_conversations WHERE phone=r.phone AND whatsapp_number_id=r.whatsapp_number_id AND channel='whatsapp' AND NOT is_group LIMIT 1;
        IF NOT FOUND OR coalesce(c.last_incoming_at,'epoch'::timestamptz)<=coalesce(c.nm_last_outgoing_at,c.last_outgoing_at,'epoch'::timestamptz) THEN
          UPDATE public.support_outbox SET status='cancelled',error='Cliente já recebeu resposta antes do envio automático' WHERE id=r.id;
          UPDATE public.support_auto_suggestions SET status='ignorada',reason='respondida_antes_do_envio' WHERE id=r.suggestion_id AND status='nova';
          CONTINUE;
        END IF;
      END IF;
      UPDATE public.support_outbox SET claimed_at=now(),error=NULL WHERE id=r.id RETURNING * INTO r;
      RETURN NEXT r;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.support_outbox_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_outbox_claim(integer) TO service_role;