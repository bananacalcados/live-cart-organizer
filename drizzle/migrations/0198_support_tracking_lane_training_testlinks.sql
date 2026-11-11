-- Fase 4c: rastreio no agente, linha de SUPORTE, treino do agente e links de teste da Central (aditivo, modo sombra).
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS auto_route_support_line boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_share_last_event boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.support_settings.tracking_share_last_event IS 'Preparado, ainda não usado: permitir que o agente diga o último evento do rastreio no chat.';

ALTER TABLE public.support_auto_suggestions
  ADD COLUMN IF NOT EXISTS would_route_support boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routed_at timestamptz,
  ADD COLUMN IF NOT EXISTS routed_by uuid,
  ADD COLUMN IF NOT EXISTS routed_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_info jsonb;
ALTER TABLE public.support_auto_suggestions DROP CONSTRAINT IF EXISTS support_auto_suggestions_intent_check;
ALTER TABLE public.support_auto_suggestions ADD CONSTRAINT support_auto_suggestions_intent_check
  CHECK (intent = ANY (ARRAY['troca','devolucao','indefinido','rastreio']));

CREATE OR REPLACE FUNCTION public._support_move_to_support_line(p_phone text, p_number uuid, p_by uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),8);
BEGIN
  IF length(k) < 8 THEN RETURN false; END IF;
  INSERT INTO public.chat_conversation_lanes(phone_key, whatsapp_number_id, lane, moved_by, moved_at)
  VALUES (k, coalesce(p_number::text,''), 'support', p_by, now())
  ON CONFLICT (phone_key, whatsapp_number_id) DO UPDATE SET lane='support', moved_by=EXCLUDED.moved_by, moved_at=now()
    WHERE chat_conversation_lanes.lane IS DISTINCT FROM 'support';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._support_move_to_support_line(text,uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_suggestion_route(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugestão não encontrada'; END IF;
  IF s.channel <> 'whatsapp' THEN RAISE EXCEPTION 'Só conversas de WhatsApp têm linha de Suporte'; END IF;
  IF NOT public._support_move_to_support_line(s.phone, s.whatsapp_number_id, auth.uid()) THEN RAISE EXCEPTION 'Telefone inválido'; END IF;
  UPDATE public.support_auto_suggestions SET routed_at = now(), routed_by = auth.uid(), routed_auto = false WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.support_suggestion_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_suggestion_route(uuid) TO authenticated;

-- Automático só com o interruptor ligado E modo automático (sombra nunca move).
CREATE OR REPLACE FUNCTION public.support_auto_route(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; st record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT auto_route_support_line, auto_reply_mode INTO st FROM public.support_settings WHERE id = true;
  IF NOT coalesce(st.auto_route_support_line,false) OR st.auto_reply_mode <> 'auto' THEN RETURN false; END IF;
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT s.would_route_support OR s.routed_at IS NOT NULL OR s.channel <> 'whatsapp' THEN RETURN false; END IF;
  IF NOT public._support_move_to_support_line(s.phone, s.whatsapp_number_id, NULL) THEN RETURN false; END IF;
  UPDATE public.support_auto_suggestions SET routed_at = now(), routed_auto = true WHERE id = p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.support_auto_route(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_auto_route(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_auto_reply_settings_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object('mode', auto_reply_mode, 'instance_ids', to_jsonb(auto_reply_instance_ids), 'support_whatsapp_phone', support_whatsapp_phone,
    'central_public_enabled', central_public_enabled, 'auto_route_support_line', auto_route_support_line,
    'is_admin', public.has_role(auth.uid(),'admin')) INTO r FROM public.support_settings LIMIT 1;
  RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.support_route_settings_update(p_auto_route boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Só admin pode alterar'; END IF;
  UPDATE public.support_settings SET auto_route_support_line = coalesce(p_auto_route,false), updated_at = now()
  WHERE auto_route_support_line IS DISTINCT FROM coalesce(p_auto_route,false);
END $$;
REVOKE ALL ON FUNCTION public.support_route_settings_update(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_route_settings_update(boolean) TO authenticated;

-- ===== Treino do agente =====
CREATE TABLE IF NOT EXISTS public.support_training_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  label text NOT NULL,
  days integer NOT NULL DEFAULT 7,
  eligible_conversations integer NOT NULL DEFAULT 0,
  selected_conversations integer NOT NULL DEFAULT 0,
  est_cost_usd numeric,
  notes text,
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.support_training_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.support_training_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  phone text NOT NULL,
  whatsapp_number_id uuid,
  channel text NOT NULL DEFAULT 'whatsapp',
  instance_name text,
  last_incoming_at timestamptz,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','ok','erro')),
  attempts integer NOT NULL DEFAULT 0,
  customer_name text,
  conversation jsonb,
  orders_ctx jsonb,
  triage jsonb,
  triage_category text,
  triage_confidence numeric,
  is_support boolean,
  review_group text CHECK (review_group IN ('suporte','amostra_nao_suporte')),
  agent_text text,
  agent_actions jsonb,
  decision text,
  reason text,
  handoff_summary text,
  would_route_support boolean,
  tracking_info jsonb,
  tokens_in integer,
  tokens_out integer,
  error text,
  processed_at timestamptz,
  review_class_ok boolean,
  review_correct_category text,
  review_reply_ok boolean,
  review_comment text,
  review_ideal_reply text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  UNIQUE (run_id, phone, whatsapp_number_id)
);
CREATE INDEX IF NOT EXISTS support_training_items_run_status ON public.support_training_items(run_id, status);
CREATE INDEX IF NOT EXISTS support_training_items_review ON public.support_training_items(run_id, review_group, last_incoming_at DESC);
REVOKE ALL ON public.support_training_runs, public.support_training_items FROM anon, authenticated;
GRANT SELECT ON public.support_training_runs, public.support_training_items TO authenticated;
GRANT ALL ON public.support_training_runs, public.support_training_items TO service_role;
ALTER TABLE public.support_training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_training_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "desk staff reads training runs" ON public.support_training_runs FOR SELECT TO authenticated USING (public._exchange_desk_staff(auth.uid()));
CREATE POLICY "desk staff reads training items" ON public.support_training_items FOR SELECT TO authenticated USING (public._exchange_desk_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.support_training_claim(p_run uuid, p_n integer)
RETURNS SETOF public.support_training_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY UPDATE public.support_training_items t SET status = 'processando', attempts = t.attempts + 1
    WHERE t.id IN (SELECT id FROM public.support_training_items WHERE run_id = p_run AND status = 'pendente'
                   ORDER BY last_incoming_at DESC LIMIT least(greatest(coalesce(p_n,1),1),10) FOR UPDATE SKIP LOCKED)
    RETURNING t.*;
END $$;
REVOKE ALL ON FUNCTION public.support_training_claim(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_training_claim(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.support_training_list(p_run uuid, p_group text DEFAULT 'suporte', p_pending_only boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS SETOF public.support_training_items LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.support_training_items
    WHERE run_id = p_run AND review_group = p_group AND (NOT coalesce(p_pending_only,false) OR reviewed_at IS NULL)
    ORDER BY last_incoming_at DESC, id LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0);
END $$;
REVOKE ALL ON FUNCTION public.support_training_list(uuid,text,boolean,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_training_list(uuid,text,boolean,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_training_stats(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'total', count(*), 'ok', count(*) FILTER (WHERE status='ok'), 'erro', count(*) FILTER (WHERE status='erro'),
    'pendente', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'por_tipo', (SELECT coalesce(jsonb_object_agg(c, n),'{}') FROM (SELECT coalesce(triage_category,'sem') c, count(*) n FROM public.support_training_items WHERE run_id=p_run GROUP BY 1) z),
    'suporte', count(*) FILTER (WHERE review_group='suporte'), 'amostra', count(*) FILTER (WHERE review_group='amostra_nao_suporte'),
    'revisadas', count(*) FILTER (WHERE reviewed_at IS NOT NULL),
    'class_ok', count(*) FILTER (WHERE review_class_ok), 'class_err', count(*) FILTER (WHERE review_class_ok = false),
    'reply_ok', count(*) FILTER (WHERE review_reply_ok), 'reply_err', count(*) FILTER (WHERE review_reply_ok = false),
    'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0))
  INTO r FROM public.support_training_items WHERE run_id = p_run;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.support_training_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_training_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_training_review(p_id uuid, p_class_ok boolean, p_correct_category text, p_reply_ok boolean, p_comment text, p_ideal_reply text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Só admin revisa o treino'; END IF;
  IF p_correct_category IS NOT NULL AND p_correct_category NOT IN ('venda','troca','devolucao','troca_ou_devolucao_ambiguo','rastreio','outro_suporte','nada') THEN RAISE EXCEPTION 'Categoria inválida'; END IF;
  IF length(coalesce(p_comment,'')) > 2000 OR length(coalesce(p_ideal_reply,'')) > 2000 THEN RAISE EXCEPTION 'Texto muito longo'; END IF;
  UPDATE public.support_training_items SET review_class_ok = p_class_ok,
    review_correct_category = CASE WHEN p_class_ok THEN NULL ELSE p_correct_category END,
    review_reply_ok = p_reply_ok, review_comment = nullif(trim(coalesce(p_comment,'')),''),
    review_ideal_reply = nullif(trim(coalesce(p_ideal_reply,'')),''), reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.support_training_review(uuid,boolean,text,boolean,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_training_review(uuid,boolean,text,boolean,text,text) TO authenticated;

-- ===== Links de TESTE da Central =====
ALTER TABLE public.support_links ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.central_test_link_ok(p_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'service_role' AND EXISTS (SELECT 1 FROM public.support_links WHERE token_hash = p_hash AND is_test AND revoked_at IS NULL AND expires_at > now());
$$;
REVOKE ALL ON FUNCTION public.central_test_link_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.central_test_link_ok(text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_support_test_link(p_order_ref text, p_request_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Só admin cria link de teste'; END IF;
  r := public.create_support_link(p_order_ref, p_request_type, 'system', NULL);
  UPDATE public.support_links SET is_test = true WHERE id = (r->>'id')::uuid;
  RETURN r || jsonb_build_object('is_test', true);
END $$;
REVOKE ALL ON FUNCTION public.create_support_test_link(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_test_link(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_delete_test(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exchange_requests WHERE id = p_id AND is_test) THEN RAISE EXCEPTION 'Só solicitações de TESTE podem ser apagadas'; END IF;
  UPDATE public.support_links SET submitted_request_id = NULL WHERE submitted_request_id = p_id;
  DELETE FROM public.exchange_request_events WHERE request_id = p_id;
  DELETE FROM public.exchange_requests WHERE id = p_id AND is_test;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_delete_test(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_delete_test(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sale_has_only_test_requests(p_sale uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.exchange_requests WHERE sale_id = p_sale AND is_test AND status NOT IN ('concluido','cancelado','recusado'))
     AND NOT EXISTS (SELECT 1 FROM public.exchange_requests WHERE sale_id = p_sale AND NOT is_test AND status NOT IN ('concluido','cancelado','recusado'));
$$;
REVOKE ALL ON FUNCTION public.sale_has_only_test_requests(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_has_only_test_requests(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text, p_type text, p_item uuid, p_quantity integer, p_reason text, p_detail text, p_replacement uuid, p_unused boolean, p_desired text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l record; e jsonb; s record; i record; p record; found_id uuid; td record; qty numeric; approved boolean; trusted boolean; why text; rid uuid; newsku text; newsize text; req boolean; wish text;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
wish:=nullif(trim(coalesce(p_desired,'')),'');
IF p_type NOT IN ('troca','devolucao') OR p_reason NOT IN ('tamanho','defeito','nao_gostou','produto_errado','outro') OR p_quantity IS NULL OR p_quantity<1 OR p_quantity>100 OR length(coalesce(p_detail,''))>1000 OR length(trim(coalesce(p_detail,'')))<3 OR p_type='devolucao' AND p_replacement IS NOT NULL OR length(coalesce(wish,''))>200 THEN RETURN jsonb_build_object('error','Confira os dados da solicitação.'); END IF;
IF p_type='devolucao' THEN wish:=NULL; END IF;
SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
-- Interruptor desligado: qualquer produto enviado pelo navegador é ignorado (nada é reservado).
IF p_type='troca' AND NOT req THEN p_replacement:=NULL; ELSE wish:=NULL; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
IF NOT FOUND THEN RETURN NULL; END IF;
-- Link reaberto: vale para itens ainda sem solicitação aberta (checagem por item abaixo).
e:=check_exchange_eligibility(l.order_ref,p_type);
IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
SELECT * INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid FOR UPDATE;
SELECT * INTO i FROM pos_sale_items WHERE id=p_item AND sale_id=s.id;
IF NOT FOUND OR p_quantity>i.quantity THEN RETURN jsonb_build_object('error','Confira o item e a quantidade.'); END IF;
SELECT id INTO found_id FROM exchange_requests WHERE sale_id=s.id AND status NOT IN ('concluido','cancelado','recusado') AND (original_item_id=i.id OR original_item_id IS NULL AND product_sku=i.sku) ORDER BY created_at LIMIT 1;
IF found_id IS NOT NULL THEN RETURN jsonb_build_object('id',found_id,'existing',true); END IF;
SELECT t.id,t.codigo_devolucao INTO td FROM trocas_devolucoes t JOIN trocas_devolucoes_itens ti ON ti.troca_devolucao_id=t.id AND ti.direcao='devolvido' WHERE t.pedido_original_id=s.id AND t.status NOT IN ('concluida','cancelada') AND (ti.sku=i.sku OR ti.barcode IS NOT NULL AND ti.barcode=i.barcode) LIMIT 1;
IF td.id IS NOT NULL THEN RETURN jsonb_build_object('existing',true,'legacy_code',td.codigo_devolucao,'status','em_andamento'); END IF;
SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
approved:=coalesce(e->>'eligible'='eligible' AND trusted IS TRUE AND p_unused IS TRUE AND p_reason IN ('tamanho','nao_gostou') AND s.status_cancelamento IS DISTINCT FROM 'cancelado' AND s.status NOT IN ('cancelled','refunded'),false);
why:=CASE WHEN trusted IS NOT TRUE THEN 'Ainda precisamos confirmar a data de entrega com a transportadora.' WHEN e->>'eligible'<>'eligible' THEN 'O prazo precisa ser analisado por um atendente.' WHEN NOT p_unused OR p_reason NOT IN ('tamanho','nao_gostou') THEN 'Um atendente precisa conferir o motivo e as condições do produto.' ELSE 'Precisamos conferir a situação do pedido.' END;
IF p_type='troca' THEN
IF NOT req THEN approved:=false; why:='Cliente não escolheu o produto: escolha e separe o produto';
ELSIF p_replacement IS NULL THEN approved:=false; why:='Um atendente ajudará a escolher o produto da troca.';
ELSE
SELECT * INTO p FROM pos_products WHERE id=p_replacement FOR UPDATE;
IF NOT FOUND OR p.store_id IS DISTINCT FROM s.store_id THEN RETURN jsonb_build_object('error','Este produto não está disponível. Escolha novamente.'); END IF;
SELECT coalesce(sum(replacement_reserved_quantity),0) INTO qty FROM exchange_requests WHERE replacement_product_id=p.id AND status NOT IN ('concluido','cancelado','recusado');
IF p.stock-qty<p_quantity AND get_restock_mode(p.sku)='nao_oferecer' THEN RETURN jsonb_build_object('error','Este tamanho acabou. Escolha outra opção ou peça ajuda ao atendente.'); END IF;
IF p.stock-qty<p_quantity OR p.price IS DISTINCT FROM i.unit_price THEN approved:=false; why:='A disponibilidade ou a diferença entre os produtos precisa de conferência da equipe.'; END IF;
newsku:=p.sku; newsize:=p.size;
END IF; END IF;
INSERT INTO exchange_requests(phone,customer_name,order_ref,sale_id,request_type,channel_origin,original_item_id,requested_quantity,product_name,product_sku,product_size,reason_category,customer_verbatim,status,auto_approved,requires_human_review,escalated_reason,eligibility,eligibility_reason,delivered_at_used,delivered_source,deadline_at,replacement_product_id,new_sku,new_variant_id,desired_size,replacement_reserved_quantity,customer_product_request)
VALUES(coalesce(s.customer_phone,l.customer_phone,''),s.customer_name,l.order_ref,s.id,p_type,'site',i.id,p_quantity,i.product_name,i.sku,i.size,p_reason::exchange_reason_category,p_detail,CASE WHEN approved THEN 'aprovado'::exchange_status ELSE 'escalado'::exchange_status END,approved,NOT approved,CASE WHEN NOT approved THEN why END,CASE WHEN approved THEN 'eligible' ELSE 'needs_human' END,why,(e->>'delivered_at')::timestamptz,CASE WHEN trusted IS TRUE THEN 'carrier' ELSE NULL END,(e->>'deadline_at')::timestamptz,p_replacement,newsku,p_replacement::text,newsize,CASE WHEN p_replacement IS NOT NULL THEN p_quantity ELSE 0 END,wish) RETURNING id INTO rid;
IF l.is_test THEN UPDATE exchange_requests SET is_test=true WHERE id=rid; END IF;
UPDATE support_links SET used_at=coalesce(used_at,now()),submitted_request_id=coalesce(submitted_request_id,rid) WHERE id=l.id;
RETURN jsonb_build_object('id',rid,'status',CASE WHEN approved THEN 'aprovado' ELSE 'escalado' END,'reason',CASE WHEN NOT approved THEN why END,'existing',false);
END $function$;

CREATE OR REPLACE FUNCTION public.exchange_desk_action(p_id uuid, p_action text, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text, p_troca_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); e record; newst text; nm text; rs text := nullif(trim(coalesce(p_reason,'')),''); nt text := nullif(trim(coalesce(p_note,'')),'');
BEGIN
  IF NOT public._exchange_desk_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(rs,'')) > 300 OR length(coalesce(nt,'')) > 1000 THEN RAISE EXCEPTION 'Texto muito longo'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF e.is_test AND p_action IN ('link_troca','set_reverse') THEN RAISE EXCEPTION 'Solicitação de TESTE não gera reversa nem registro de troca'; END IF;
  IF e.request_type = 'troca' AND e.replacement_product_id IS NULL AND p_action IN ('approve','link_troca','set_reverse') THEN
    RAISE EXCEPTION 'Escolha e separe o produto novo antes';
  END IF;
  SELECT coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) INTO nm FROM auth.users WHERE id = uid;
  newst := e.status::text;
  IF p_action = 'assign' THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.exchange_desk_list(p_tab text, p_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE d text := regexp_replace(coalesce(p_search,''),'\D','','g'); s text := trim(coalesce(p_search,'')); r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(s) > 100 OR p_offset < 0 OR p_offset > 10000 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO r FROM (
    SELECT e.id, e.request_type, split_part(coalesce(e.customer_name,''),' ',1) AS first_name, e.phone, e.order_ref, e.order_number,
      e.product_name, e.product_size, e.desired_size, e.requested_quantity, e.reason_category::text AS reason, e.status::text AS status,
      e.escalated_reason, e.created_at, e.assigned_to, e.reverse_shipping_code, e.trocas_devolucoes_id, e.is_test
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
END $function$;