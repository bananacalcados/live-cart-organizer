ALTER TABLE public.support_auto_suggestions
  ADD COLUMN return_flow_state text,
  ADD COLUMN return_flow_reason text,
  ADD COLUMN return_flow_pending_link text,
  ADD COLUMN return_flow_continuation boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_auto_suggestions
  ADD CONSTRAINT support_return_flow_state_check CHECK (return_flow_state IS NULL OR return_flow_state IN ('motivo_perguntado','troca_oferecida','troca_aceita','devolucao_confirmada')) NOT VALID,
  ADD CONSTRAINT support_return_flow_pending_link_check CHECK (return_flow_pending_link IS NULL OR return_flow_pending_link IN ('troca','devolucao')) NOT VALID;
CREATE INDEX support_suggestions_return_flow_idx ON public.support_auto_suggestions(phone,whatsapp_number_id,channel,created_at DESC)
  WHERE status='enviada' AND return_flow_state IS NOT NULL;

ALTER TABLE public.exchange_requests
  ADD COLUMN intent_confirmation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN intent_confirmation_note text;
COMMENT ON COLUMN public.exchange_requests.intent_confirmation_required IS 'Bloqueia produto novo e avanços até a equipe confirmar com a cliente se quer troca ou devolução.';

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
  IF s.return_flow_continuation THEN
    IF EXISTS(SELECT 1 FROM public.support_outbox o WHERE o.requested_by='assistant_auto' AND o.phone=s.phone AND o.whatsapp_number_id=s.whatsapp_number_id AND o.status='pending' AND o.claimed_at IS NOT NULL) THEN
      RETURN jsonb_build_object('queued',false,'reason','envio_anterior_em_andamento');
    END IF;
    WITH cancelled AS (
      UPDATE public.support_outbox SET status='cancelled',error='Substituída pela resposta mais recente da cliente'
      WHERE requested_by='assistant_auto' AND phone=s.phone AND whatsapp_number_id=s.whatsapp_number_id AND status='pending' AND claimed_at IS NULL
      RETURNING suggestion_id
    )
    UPDATE public.support_auto_suggestions SET status='ignorada',reason='substituida_por_continuidade'
    WHERE id IN (SELECT suggestion_id FROM cancelled WHERE suggestion_id IS NOT NULL) AND status='nova';
  ELSIF EXISTS(SELECT 1 FROM public.support_outbox o WHERE o.requested_by='assistant_auto' AND o.phone=s.phone AND o.whatsapp_number_id=s.whatsapp_number_id AND (o.status='pending' OR o.status='sent' AND o.sent_at>=now()-interval '24 hours')) THEN
    RETURN jsonb_build_object('queued',false,'reason','limite_24h_ou_ja_na_fila');
  END IF;
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

CREATE OR REPLACE FUNCTION public.exchange_desk_choose_product(p_id uuid, p_product uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); e record; p record; sstore uuid; qty numeric; need int; nm text; nt text := nullif(trim(coalesce(p_note,'')),'');
BEGIN
  IF NOT public._exchange_desk_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(nt,'')) > 1000 THEN RAISE EXCEPTION 'Texto muito longo'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF e.intent_confirmation_required THEN RAISE EXCEPTION 'Confirme com a cliente: troca ou devolução. Não separe produto novo antes disso.'; END IF;
  IF e.request_type <> 'troca' THEN RAISE EXCEPTION 'Só troca tem produto novo'; END IF;
  IF e.status NOT IN ('escalado','solicitado') THEN RAISE EXCEPTION 'Só dá para escolher o produto antes de aprovar'; END IF;
  SELECT store_id INTO sstore FROM pos_sales WHERE id = e.sale_id;
  SELECT * INTO p FROM pos_products WHERE id = p_product FOR UPDATE;
  IF NOT FOUND OR p.store_id IS DISTINCT FROM sstore THEN RAISE EXCEPTION 'Produto não é da loja da venda'; END IF;
  need := coalesce(e.requested_quantity,1);
  SELECT coalesce(sum(replacement_reserved_quantity),0) INTO qty FROM exchange_requests WHERE replacement_product_id = p.id AND id <> e.id AND status NOT IN ('concluido','cancelado','recusado');
  IF p.stock - qty < need AND public.get_restock_mode(p.sku) = 'nao_oferecer' THEN RAISE EXCEPTION 'Este produto não tem estoque livre'; END IF;
  SELECT coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) INTO nm FROM auth.users WHERE id = uid;
  UPDATE exchange_requests SET replacement_product_id = p.id, new_sku = p.sku, new_variant_id = p.id::text, desired_size = p.size,
    replacement_reserved_quantity = need, product_chosen_by = uid, product_chosen_at = now(), updated_at = now() WHERE id = p_id;
  INSERT INTO exchange_request_events (request_id, actor, actor_name, action, from_status, to_status, reason, note)
  VALUES (p_id, uid, nm, 'choose_product', e.status::text, e.status::text, NULL, coalesce(nt, p.name || ' nº ' || coalesce(p.size,'único')));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_choose_product(uuid,uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.exchange_desk_choose_product(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_action(p_id uuid, p_action text, p_reason text DEFAULT NULL, p_note text DEFAULT NULL, p_assignee uuid DEFAULT NULL, p_code text DEFAULT NULL, p_troca_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); e record; newst text; nm text; rs text := nullif(trim(coalesce(p_reason,'')),''); nt text := nullif(trim(coalesce(p_note,'')),'');
BEGIN
  IF NOT public._exchange_desk_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(rs,'')) > 300 OR length(coalesce(nt,'')) > 1000 THEN RAISE EXCEPTION 'Texto muito longo'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF e.intent_confirmation_required AND p_action IN ('approve','link_troca','set_reverse') THEN
    RAISE EXCEPTION 'Confirme com a cliente: troca ou devolução antes de avançar';
  END IF;
  IF e.request_type = 'troca' AND e.replacement_product_id IS NULL AND p_action IN ('approve','link_troca','set_reverse') THEN
    RAISE EXCEPTION 'Escolha e separe o produto novo antes';
  END IF;
  SELECT coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) INTO nm FROM auth.users WHERE id = uid;
  newst := e.status::text;
  IF p_action = 'confirm_intent' THEN
    IF NOT e.intent_confirmation_required THEN RAISE EXCEPTION 'Esta solicitação não está aguardando confirmação'; END IF;
    UPDATE exchange_requests SET intent_confirmation_required=false,intent_confirmation_note=coalesce(nt,'Troca ou devolução confirmada pela equipe com a cliente'),updated_at=now() WHERE id=p_id;
  ELSIF p_action = 'assign' THEN
    UPDATE exchange_requests SET assigned_to = coalesce(p_assignee, uid), assigned_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'approve' THEN
    IF e.status <> 'escalado' THEN RAISE EXCEPTION 'Só dá para aprovar solicitação que está com o atendente'; END IF;
    IF rs IS NULL OR length(rs) < 3 THEN RAISE EXCEPTION 'Informe o motivo da aprovação'; END IF;
    newst := 'aprovado';
    UPDATE exchange_requests SET status = 'aprovado', requires_human_review = false, decided_by = uid, decided_at = now(), decision_reason = rs, reviewed_by = nm, reviewed_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'deny' THEN
    IF e.status NOT IN ('escalado','solicitado') THEN RAISE EXCEPTION 'Esta solicitação não pode mais ser negada'; END IF;
    IF rs IS NULL OR length(rs) < 3 THEN RAISE EXCEPTION 'Informe o motivo da negativa'; END IF;
    newst := 'recusado';
    UPDATE exchange_requests SET status = 'recusado', requires_human_review = false, decided_by = uid, decided_at = now(), decision_reason = rs, reviewed_by = nm, reviewed_at = now(), replacement_reserved_quantity = 0, updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'request_info' THEN
    IF e.status NOT IN ('escalado','solicitado') THEN RAISE EXCEPTION 'Esta solicitação já foi decidida'; END IF;
    UPDATE exchange_requests SET desk_info_requested_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'offer_size' OR p_action = 'note' OR p_action = 'open_whatsapp' THEN
    NULL;
  ELSIF p_action = 'link_troca' THEN
    IF e.status NOT IN ('aprovado','aguardando_postagem','em_transito','recebido') THEN RAISE EXCEPTION 'Só solicitação aprovada vira registro de troca'; END IF;
    IF e.trocas_devolucoes_id IS NOT NULL THEN RAISE EXCEPTION 'Esta solicitação já tem registro de troca'; END IF;
    IF p_troca_id IS NULL OR NOT EXISTS (SELECT 1 FROM trocas_devolucoes WHERE id = p_troca_id AND pedido_original_id = e.sale_id) THEN RAISE EXCEPTION 'Registro de troca inválido'; END IF;
    UPDATE exchange_requests SET trocas_devolucoes_id = p_troca_id, updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'set_reverse' THEN
    IF e.status <> 'aprovado' THEN RAISE EXCEPTION 'Reversa só para solicitação aprovada'; END IF;
    IF e.reverse_shipping_code IS NOT NULL THEN RAISE EXCEPTION 'Esta solicitação já tem reversa'; END IF;
    IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6,20}$' THEN RAISE EXCEPTION 'Código de postagem inválido'; END IF;
    newst := 'aguardando_postagem';
    UPDATE exchange_requests SET reverse_shipping_code = p_code, status = 'aguardando_postagem', updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  INSERT INTO exchange_request_events (request_id, actor, actor_name, action, from_status, to_status, reason, note)
  VALUES (p_id, uid, nm, p_action, e.status::text, newst, rs, coalesce(nt, CASE WHEN p_action='set_reverse' THEN p_code END));
  RETURN jsonb_build_object('ok', true, 'status', newst);
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_action(uuid,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.exchange_desk_action(uuid,text,text,text,uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_list(p_tab text, p_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d text := regexp_replace(coalesce(p_search,''),'\D','','g'); s text := trim(coalesce(p_search,'')); r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(s) > 100 OR p_offset < 0 OR p_offset > 10000 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO r FROM (
    SELECT e.id, e.request_type, split_part(coalesce(e.customer_name,''),' ',1) AS first_name, e.customer_name, e.phone, e.whatsapp_number_id, e.order_ref, e.order_number,
      e.product_name, e.product_size, e.desired_size, e.suggested_size, e.requested_quantity, e.reason_category::text AS reason, e.status::text AS status,
      e.escalated_reason, e.created_at, e.assigned_to, e.reverse_shipping_code, e.trocas_devolucoes_id, e.is_test, e.intent_confirmation_required
    FROM exchange_requests e
    WHERE CASE p_tab
        WHEN 'precisa' THEN e.status = 'escalado' OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NULL)
        WHEN 'andamento' THEN e.status IN ('solicitado','aguardando_postagem','em_transito','recebido') OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NOT NULL)
        WHEN 'concluidas' THEN e.status IN ('concluido','recusado','cancelado')
        ELSE false END
      AND (p_type IS NULL OR e.request_type = p_type)
      AND (p_reason IS NULL OR e.reason_category::text = p_reason)
      AND (p_assignee IS NULL OR e.assigned_to = p_assignee)
      AND (s = '' OR e.customer_name ILIKE '%'||s||'%' OR e.order_ref ILIKE '%'||s||'%' OR e.order_number ILIKE '%'||s||'%'
           OR (length(d) >= 4 AND regexp_replace(e.phone,'\D','','g') LIKE '%'||d||'%'))
    ORDER BY e.created_at, e.id
    LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET p_offset) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) TO authenticated,service_role;