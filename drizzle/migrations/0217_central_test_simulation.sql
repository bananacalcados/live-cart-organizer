ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS test_simulation jsonb;
ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS test_simulated_at timestamptz;
COMMENT ON COLUMN public.exchange_requests.test_simulation IS 'Somente TESTE: resultado de dry_run, sem NF-e, reversa ou outbox real';

CREATE OR REPLACE FUNCTION public.create_support_link(p_order_ref text,p_request_type text,p_created_by_kind text,p_customer_phone text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_token text; v_id uuid; v_exp timestamptz; v_sale uuid; v_test boolean;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'pos') OR has_module_access(auth.uid(),'expedition')) THEN RAISE EXCEPTION 'forbidden'; END IF;
IF p_order_ref IS NULL OR p_order_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_request_type NOT IN ('troca','devolucao') OR p_created_by_kind NOT IN ('ai','agent','system') THEN RAISE EXCEPTION 'invalid'; END IF;
SELECT id INTO v_sale FROM pos_sales WHERE id=p_order_ref::uuid;
IF v_sale IS NULL THEN RAISE EXCEPTION 'pedido indisponivel'; END IF;
v_test:=NOT coalesce((SELECT central_public_enabled FROM public.support_settings WHERE id=true),false);
v_token:=translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_');
INSERT INTO support_links(token_hash,order_ref,request_type,created_by_kind,created_by_user,is_test) VALUES(encode(extensions.digest(v_token,'sha256'),'hex'),v_sale::text,p_request_type,p_created_by_kind,auth.uid(),v_test) RETURNING id,expires_at INTO v_id,v_exp;
RETURN jsonb_build_object('id',v_id,'token',v_token,'expires_at',v_exp,'is_test',v_test,'url','https://checkout.bananacalcados.com.br/central/'||p_request_type||'/'||v_token);
END $$;
REVOKE ALL ON FUNCTION public.create_support_link(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_support_link(text,text,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.central_reverse_prepare(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; s record; i record; pc record; sim record; elig jsonb; td uuid; k text; shipped timestamptz; sa jsonb; original_key text; confirmed boolean; guaranteed boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM public.exchange_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Solicitação não encontrada'); END IF;
  IF e.is_test AND e.test_simulation IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'existing',true,'simulation',e.test_simulation); END IF;
  IF e.reverse_shipping_code IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'existing',true,'reverse_code',e.reverse_shipping_code,'status','aguardando_postagem'); END IF;
  IF e.reverse_shipment_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'pending',true,'error','A reversa já existe e precisa ser revisada pela equipe'); END IF;
  IF NOT coalesce((SELECT central_auto_reverse FROM public.support_settings WHERE id=true),false) THEN RETURN jsonb_build_object('ok',false,'skipped',true); END IF;
  SELECT * INTO s FROM public.pos_sales WHERE id=e.sale_id;
  IF NOT FOUND OR coalesce(s.sales_channel,'presencial') NOT IN ('site','live','link_online','whatsapp') THEN RETURN jsonb_build_object('ok',false,'error','Pedido online não confirmado'); END IF;
  SELECT * INTO i FROM public.pos_sale_items WHERE id=e.original_item_id AND sale_id=s.id;
  IF NOT FOUND OR e.requested_quantity<1 OR e.requested_quantity>i.quantity THEN RETURN jsonb_build_object('ok',false,'error','Item do pedido não confirmado'); END IF;
  IF EXISTS(SELECT 1 FROM public.exchange_requests x WHERE x.sale_id=s.id AND x.id<>e.id AND x.status NOT IN ('concluido','cancelado','recusado') AND (x.original_item_id=i.id OR x.original_item_id IS NULL AND x.product_sku=i.sku)) THEN RETURN jsonb_build_object('ok',false,'error','Já existe outra solicitação aberta para este item'); END IF;
  elig:=public.check_exchange_eligibility(e.order_ref,e.request_type);
  SELECT * INTO sim FROM public.shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  shipped:=coalesce(sim.posted_at,s.shipped_at,s.expedition_finished_at);
  confirmed:=elig->>'eligible'='eligible' AND sim.delivered_at IS NOT NULL AND sim.delivered_at<=now() AND sim.delivered_source='carrier';
  guaranteed:=e.status='aprovado' AND e.auto_approved=false AND elig->>'delivered_at' IS NULL AND shipped IS NOT NULL AND shipped<=now() AND now()<=shipped+interval '7 days';
  IF NOT confirmed AND NOT guaranteed THEN RETURN jsonb_build_object('ok',false,'error','Prazo de entrega ou envio não confirmado'); END IF;
  IF e.is_test THEN
    td:=NULL;
  ELSIF e.trocas_devolucoes_id IS NOT NULL THEN
    td:=e.trocas_devolucoes_id;
  ELSE
    IF EXISTS(SELECT 1 FROM public.trocas_devolucoes t JOIN public.trocas_devolucoes_itens ti ON ti.troca_devolucao_id=t.id AND ti.direcao='devolvido' WHERE t.pedido_original_id=s.id AND t.status NOT IN ('concluida','cancelada') AND (ti.sku=i.sku OR ti.barcode IS NOT NULL AND ti.barcode=i.barcode)) THEN RETURN jsonb_build_object('ok',false,'error','Já existe troca ou devolução aberta para este item'); END IF;
    SELECT f.chave_acesso INTO original_key FROM public.fiscal_documents f WHERE f.pos_sale_id=s.id AND f.status='authorized' AND f.chave_acesso IS NOT NULL AND f.modelo IN (55,65) ORDER BY f.created_at DESC LIMIT 1;
    INSERT INTO public.trocas_devolucoes(tipo,loja_origem_id,pedido_original_id,chave_acesso_original,cliente_id,motivo,status,modo_expedicao,origem_canal)
    VALUES(e.request_type::public.td_tipo,s.store_id,s.id,original_key,s.customer_id,
      CASE e.reason_category::text WHEN 'tamanho' THEN 'tamanho' WHEN 'defeito' THEN 'defeito_avaria' WHEN 'nao_gostou' THEN 'arrependimento' WHEN 'produto_errado' THEN 'erro_expedicao' ELSE 'outro' END::public.td_motivo,
      'iniciada','aguarda_retorno','site') RETURNING id INTO td;
    INSERT INTO public.trocas_devolucoes_itens(troca_devolucao_id,direcao,sku,tamanho,barcode,produto_nome,quantidade,valor_unitario,repoe_estoque,estado_estoque)
    VALUES(td,'devolvido',i.sku,i.size,i.barcode,i.product_name,e.requested_quantity,coalesce(i.fiscal_unit_price,i.unit_price),true,NULL);
    UPDATE public.exchange_requests SET trocas_devolucoes_id=td,updated_at=now() WHERE id=e.id;
  END IF;
  SELECT * INTO pc FROM public.pos_customers WHERE id=s.customer_id;
  sa:=coalesce(s.shipping_address,'{}'::jsonb);
  k:='central-'||e.id::text;
  IF e.is_test THEN UPDATE public.exchange_requests SET test_simulation=jsonb_build_object('dry_run',true,'status','running'),test_simulated_at=now(),updated_at=now() WHERE id=e.id; END IF;
  RETURN jsonb_build_object('ok',true,'is_test',e.is_test,'troca_id',td,'idempotency_key',k,'sale_id',s.id,'service_code','03301','reason',left(coalesce(e.reason_category::text,'outro'),200),
    'return_items',jsonb_build_array(jsonb_build_object('sale_item_id',i.id,'quantidade',e.requested_quantity)),
    'customer',jsonb_build_object('nome',coalesce(s.customer_name,pc.name,''),'cpf',coalesce(nullif(s.customer_cpf,''),pc.cpf),'telefone',coalesce(s.customer_phone,pc.whatsapp,e.phone),'email',coalesce(s.customer_email,pc.email),
      'cep',coalesce(nullif(sa->>'zip',''),nullif(sa->>'cep',''),pc.cep,s.customer_cep,''),
      'logradouro',coalesce(nullif(sa->>'address1',''),nullif(sa->>'address',''),pc.address,''),
      'numero',coalesce(nullif(sa->>'number',''),pc.address_number,'S/N'),'complemento',coalesce(nullif(sa->>'complement',''),pc.complement),
      'bairro',coalesce(nullif(sa->>'neighborhood',''),nullif(sa->>'address2',''),pc.neighborhood,''),
      'cidade',coalesce(nullif(sa->>'city',''),pc.city,s.customer_city,''),'uf',coalesce(nullif(sa->>'province_code',''),nullif(sa->>'province',''),nullif(sa->>'state',''),pc.state,s.customer_state,'')));
END $$;
REVOKE ALL ON FUNCTION public.central_reverse_prepare(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_reverse_prepare(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.central_test_simulation_finish(p_request_id uuid,p_simulation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_simulation IS NULL OR p_simulation->>'dry_run' IS NULL THEN RAISE EXCEPTION 'Simulação inválida'; END IF;
  SELECT * INTO e FROM public.exchange_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT e.is_test THEN RAISE EXCEPTION 'Só solicitação de TESTE aceita simulação'; END IF;
  IF e.test_simulation IS NOT NULL AND e.test_simulation->>'status' IS DISTINCT FROM 'running' THEN RETURN jsonb_build_object('simulation',e.test_simulation); END IF;
  UPDATE public.exchange_requests SET test_simulation=p_simulation,test_simulated_at=now(),updated_at=now() WHERE id=e.id;
  INSERT INTO public.exchange_request_events(request_id,actor_name,action,note) VALUES(e.id,'Central de TESTE','test_simulated','Dry run concluído sem NF-e, reversa ou mensagem real');
  RETURN jsonb_build_object('simulation',p_simulation);
END $$;
REVOKE ALL ON FUNCTION public.central_test_simulation_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_test_simulation_finish(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.central_context(p_hash text, p_type text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; e jsonb; s record; items jsonb; progress jsonb; trusted boolean; req boolean; simulation jsonb;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now();
IF NOT FOUND THEN RETURN NULL; END IF;
e:=check_exchange_eligibility(l.order_ref,p_type);
IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
SELECT id,customer_name,created_at INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid;
SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
SELECT test_simulation INTO simulation FROM exchange_requests WHERE id=l.submitted_request_id AND is_test;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'item_id',r.original_item_id,'item_name',r.product_name,'item_size',r.product_size,'status',r.status,'type',r.request_type,'reason',r.escalated_reason,'created_at',r.created_at,
  'reverse_code',coalesce(nullif(r.reverse_shipping_code,''),rv.codigo_objeto),'reverse_valid_until',rv.valid_until) ORDER BY r.created_at),'[]') INTO progress
FROM exchange_requests r LEFT JOIN correios_reverse_shipments rv ON rv.id=r.reverse_shipment_id AND coalesce(rv.status,'') NOT IN ('cancelada','cancelado','erro')
WHERE r.sale_id=s.id AND (r.id=l.submitted_request_id OR r.status NOT IN ('concluido','cancelado','recusado'));
SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'size',i.size,'quantity',i.quantity,
  'open',EXISTS(SELECT 1 FROM exchange_requests x WHERE x.sale_id=s.id AND x.status NOT IN ('concluido','cancelado','recusado') AND (x.original_item_id=i.id OR x.original_item_id IS NULL AND x.product_sku=i.sku))
  OR EXISTS(SELECT 1 FROM trocas_devolucoes t JOIN public.trocas_devolucoes_itens ti ON ti.troca_devolucao_id=t.id AND ti.direcao='devolvido' WHERE t.pedido_original_id=s.id AND t.status NOT IN ('concluida','cancelada') AND (ti.sku=i.sku OR ti.barcode IS NOT NULL AND ti.barcode=i.barcode))) ORDER BY i.created_at,i.id),'[]') INTO items
FROM pos_sale_items i WHERE i.sale_id=s.id;
RETURN jsonb_build_object('first_name',split_part(trim(coalesce(s.customer_name,'Cliente')),' ',1),'items',items,'purchased_at',s.created_at,'delivered_at',e->'delivered_at','deadline_at',e->'deadline_at','eligibility',CASE WHEN e->>'eligible'='eligible' AND trusted IS TRUE THEN 'eligible' ELSE 'needs_human' END,'used',l.used_at IS NOT NULL,'progress',progress,'type',p_type,'require_product_choice',CASE WHEN p_type='troca' THEN req ELSE false END,'is_test',l.is_test,'test_simulation',simulation);
END $$;
REVOKE EXECUTE ON FUNCTION public.central_context(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_context(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text, p_type text, p_item uuid, p_quantity integer, p_reason text, p_detail text, p_replacement uuid, p_unused boolean, p_desired text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; e jsonb; s record; i record; p record; found_id uuid; td record; qty numeric; approved boolean; trusted boolean; why text; rid uuid; newsku text; newsize text; req boolean; wish text;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
wish:=nullif(trim(coalesce(p_desired,'')),'');
IF p_type NOT IN ('troca','devolucao') OR p_reason NOT IN ('tamanho','defeito','nao_gostou','produto_errado','outro') OR p_quantity IS NULL OR p_quantity<1 OR p_quantity>100 OR length(coalesce(p_detail,''))>1000 OR length(trim(coalesce(p_detail,'')))<3 OR p_type='devolucao' AND p_replacement IS NOT NULL OR length(coalesce(wish,''))>200 THEN RETURN jsonb_build_object('error','Confira os dados da solicitação.'); END IF;
IF p_type='devolucao' THEN wish:=NULL; END IF;
SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
IF p_type='troca' AND NOT req THEN p_replacement:=NULL; ELSE wish:=NULL; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
IF NOT FOUND THEN RETURN NULL; END IF;
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
IF NOT req THEN
  IF approved THEN why:='Cliente não escolheu o produto: escolha e separe o produto'; END IF;
  approved:=false;
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
END $$;
REVOKE EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) TO service_role;