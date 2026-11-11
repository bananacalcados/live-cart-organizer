-- Interruptor: exigir que a cliente escolha o produto novo na troca (padrão ligado = comportamento atual).
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS central_require_product_choice boolean NOT NULL DEFAULT true;
ALTER TABLE public.exchange_requests
  ADD COLUMN IF NOT EXISTS customer_product_request text,
  ADD COLUMN IF NOT EXISTS product_chosen_by uuid,
  ADD COLUMN IF NOT EXISTS product_chosen_at timestamptz;
ALTER TABLE public.exchange_requests ADD CONSTRAINT exchange_requests_customer_product_request_len CHECK (customer_product_request IS NULL OR length(customer_product_request) <= 200) NOT VALID;

CREATE OR REPLACE FUNCTION public.central_context(p_hash text, p_type text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE l record; e jsonb; s record; items jsonb; progress jsonb; trusted boolean; req boolean;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now();
IF NOT FOUND OR l.used_at IS NOT NULL THEN RETURN NULL; END IF;
e:=check_exchange_eligibility(l.order_ref,p_type);
IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
SELECT id,customer_name,created_at INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid;
SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'size',i.size,'quantity',i.quantity) ORDER BY i.created_at,i.id),'[]') INTO items FROM pos_sale_items i WHERE i.sale_id=s.id;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'item_id',r.original_item_id,'status',r.status,'type',r.request_type,'reason',r.escalated_reason,'created_at',r.created_at)),'[]') INTO progress FROM exchange_requests r WHERE r.sale_id=s.id AND (r.id=l.submitted_request_id OR r.status NOT IN ('concluido','cancelado','recusado'));
RETURN jsonb_build_object('first_name',split_part(trim(coalesce(s.customer_name,'Cliente')),' ',1),'items',items,'purchased_at',s.created_at,'delivered_at',e->'delivered_at','deadline_at',e->'deadline_at','eligibility',CASE WHEN e->>'eligible'='eligible' AND trusted IS TRUE THEN 'eligible' ELSE 'needs_human' END,'used',l.used_at IS NOT NULL,'progress',progress,'type',p_type,'require_product_choice',CASE WHEN p_type='troca' THEN req ELSE false END);
END $function$;

-- Nova versão com o pedido livre da cliente (p_desired). A regra do interruptor é lida aqui no servidor.
CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text, p_type text, p_item uuid, p_quantity integer, p_reason text, p_detail text, p_replacement uuid, p_unused boolean, p_desired text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
IF l.used_at IS NOT NULL THEN RETURN NULL; END IF;
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
UPDATE support_links SET used_at=now(),submitted_request_id=rid WHERE id=l.id;
RETURN jsonb_build_object('id',rid,'status',CASE WHEN approved THEN 'aprovado' ELSE 'escalado' END,'reason',CASE WHEN NOT approved THEN why END,'existing',false);
END $function$;
REVOKE ALL ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) TO service_role;

-- Versão antiga passa pela nova, para a regra valer em qualquer caminho.
CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text, p_type text, p_item uuid, p_quantity integer, p_reason text, p_detail text, p_replacement uuid DEFAULT NULL::uuid, p_unused boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
RETURN public.central_submit_atomic(p_hash,p_type,p_item,p_quantity,p_reason,p_detail,p_replacement,p_unused,NULL::text);
END $function$;
REVOKE ALL ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean) TO service_role;

-- Opções para o atendente: mesmo modelo com estoque livre ou marcado em "Produtos para troca".
CREATE OR REPLACE FUNCTION public.exchange_desk_choice_options(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; i record; base record; r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO i FROM pos_sale_items WHERE id = e.original_item_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO base FROM pos_products WHERE store_id = (SELECT store_id FROM pos_sales WHERE id = i.sale_id) AND sku = i.sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.size, x.id),'[]') INTO r FROM (
    SELECT p.id, p.name, p.size, p.color, p.sku, p.stock - coalesce(res.qty,0) AS available,
           (p.stock - coalesce(res.qty,0) < coalesce(e.requested_quantity,1)) AS flagged
    FROM pos_products p LEFT JOIN LATERAL (SELECT sum(replacement_reserved_quantity) qty FROM exchange_requests rr WHERE rr.replacement_product_id = p.id AND rr.id <> e.id AND rr.status NOT IN ('concluido','cancelado','recusado')) res ON true
    WHERE p.store_id = base.store_id AND ((base.parent_sku IS NOT NULL AND p.parent_sku = base.parent_sku) OR p.name = base.name)
      AND (p.stock - coalesce(res.qty,0) >= coalesce(e.requested_quantity,1) OR public.get_restock_mode(p.sku) <> 'nao_oferecer')
    ORDER BY p.size, p.id LIMIT 60) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_choice_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_choice_options(uuid) TO authenticated;

-- Atendente escolhe e separa (reserva lógica, sem mexer no estoque).
CREATE OR REPLACE FUNCTION public.exchange_desk_choose_product(p_id uuid, p_product uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); e record; p record; sstore uuid; qty numeric; need int; nm text; nt text := nullif(trim(coalesce(p_note,'')),'');
BEGIN
  IF NOT public._exchange_desk_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(nt,'')) > 1000 THEN RAISE EXCEPTION 'Texto muito longo'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_action(uuid,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.exchange_desk_action(uuid,text,text,text,uuid,text,uuid) TO authenticated;