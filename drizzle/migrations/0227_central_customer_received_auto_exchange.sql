CREATE OR REPLACE FUNCTION public.check_exchange_eligibility(p_order_ref text, p_request_type text, p_customer_reported_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r text := trim(coalesce(p_order_ref,''));
  v_sale uuid; v_channel text; v_join text; v_sim record; v_days int; v_deadline timestamptz;
  v_deliv timestamptz; v_track text; v_shipped timestamptz; v_reported_ok boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_request_type NOT IN ('troca','devolucao') THEN RAISE EXCEPTION 'request_type inválido'; END IF;
  SELECT CASE WHEN p_request_type='troca' THEN exchange_window_days ELSE return_window_days END INTO v_days FROM support_settings LIMIT 1;
  v_days := coalesce(v_days, 7);
  IF r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_sale FROM pos_sales WHERE id = r::uuid;
    IF v_sale IS NOT NULL THEN v_join := 'pos_sales.id'; ELSE
      SELECT id INTO v_sale FROM pos_sales WHERE source_order_id = r::uuid ORDER BY created_at DESC LIMIT 1;
      IF v_sale IS NOT NULL THEN v_join := 'orders.id→pos_sales.source_order_id'; END IF;
    END IF;
  END IF;
  IF v_sale IS NULL AND r ~* '^[0-9a-f]{8}$' THEN
    SELECT sale_id INTO v_sale FROM shipment_simulations WHERE order_reference = upper(r) AND sale_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'shipment_simulations.order_reference'; END IF;
  END IF;
  IF v_sale IS NULL AND r <> '' THEN
    SELECT id INTO v_sale FROM pos_sales WHERE external_order_id = r OR tiny_order_number = r ORDER BY created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'pos_sales.external_order_id/tiny_order_number'; END IF;
  END IF;
  IF v_sale IS NULL AND r <> '' THEN
    SELECT ps.id INTO v_sale FROM orders o JOIN pos_sales ps ON ps.source_order_id = o.id
     WHERE o.shopify_order_id = r OR o.shopify_order_name IN (r, '#'||ltrim(r,'#')) ORDER BY ps.created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'orders.shopify_order→pos_sales.source_order_id'; END IF;
  END IF;
  IF v_sale IS NULL AND r <> '' THEN
    SELECT eo.freight_tracking_code INTO v_track FROM expedition_orders eo
     WHERE eo.shopify_order_id = r OR eo.shopify_order_number = ltrim(r,'#') OR eo.shopify_order_name IN (r, '#'||ltrim(r,'#'))
     ORDER BY eo.created_at DESC LIMIT 1;
    IF v_track IS NULL THEN v_track := r; END IF;
    SELECT sale_id INTO v_sale FROM shipment_simulations WHERE upper(real_tracking_code) = upper(v_track) AND sale_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'tracking_code→shipment_simulations'; END IF;
  END IF;
  IF v_sale IS NOT NULL THEN SELECT sales_channel, shipped_at INTO v_channel, v_shipped FROM pos_sales WHERE id = v_sale; END IF;
  IF v_sale IS NULL OR coalesce(v_channel,'presencial') NOT IN ('site','live','link_online','whatsapp') THEN
    RETURN jsonb_build_object('eligible','needs_human','reason','pedido_nao_encontrado_ou_fisico','delivered_at',NULL,'delivered_source',NULL,'deadline_at',NULL,'window_days',v_days,'carrier',NULL,'join_used',v_join,'sale_id',v_sale,'sales_channel',v_channel);
  END IF;
  SELECT id, delivered_at, delivered_source, real_carrier, real_tracking_code, posted_at INTO v_sim
    FROM shipment_simulations WHERE sale_id = v_sale AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  v_join := v_join || ' + shipment_simulations.sale_id';
  IF v_sim.delivered_at IS NOT NULL AND v_sim.delivered_source = 'carrier' THEN
    v_deadline := v_sim.delivered_at + make_interval(days => v_days);
    RETURN jsonb_build_object('eligible', CASE WHEN now() <= v_deadline THEN 'eligible' ELSE 'needs_human' END,
      'reason', CASE WHEN now() <= v_deadline THEN 'dentro_do_prazo' ELSE 'fora_do_prazo' END,
      'delivered_at', v_sim.delivered_at, 'delivered_source', 'carrier', 'deadline_at', v_deadline,
      'window_days', v_days, 'carrier', v_sim.real_carrier, 'join_used', v_join, 'sale_id', v_sale);
  END IF;
  IF p_customer_reported_date IS NOT NULL THEN
    v_deliv := (p_customer_reported_date::timestamp AT TIME ZONE 'America/Sao_Paulo');
    v_deadline := v_deliv + make_interval(days => v_days);
    v_reported_ok := v_shipped IS NOT NULL AND now() > v_shipped + interval '7 days'
      AND p_customer_reported_date >= (v_shipped AT TIME ZONE 'America/Sao_Paulo')::date
      AND p_customer_reported_date <= ((v_shipped + interval '10 days') AT TIME ZONE 'America/Sao_Paulo')::date
      AND p_customer_reported_date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
      AND now() <= v_deadline;
    RETURN jsonb_build_object('eligible',CASE WHEN v_reported_ok THEN 'eligible' ELSE 'needs_human' END,
      'reason',CASE WHEN v_reported_ok THEN 'data_informada_pelo_cliente' ELSE 'data_informada_invalida' END,
      'delivered_at',v_deliv,'delivered_source','customer_informed','deadline_at',v_deadline,
      'window_days',v_days,'carrier',v_sim.real_carrier,'join_used',v_join,'sale_id',v_sale,'shipped_at',v_shipped);
  END IF;
  RETURN jsonb_build_object('eligible','needs_human','reason','sem_data_de_entrega','delivered_at',NULL,'delivered_source',NULL,
    'deadline_at',NULL,'window_days',v_days,'carrier',v_sim.real_carrier,'join_used',v_join,'sale_id',v_sale,'shipped_at',v_shipped);
END $$;
REVOKE EXECUTE ON FUNCTION public.check_exchange_eligibility(text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_exchange_eligibility(text,text,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.central_reverse_prepare(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; s record; i record; pc record; sim record; elig jsonb; td uuid; k text; sa jsonb; original_key text; confirmed boolean; guaranteed boolean;
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
  elig:=public.check_exchange_eligibility(e.order_ref,e.request_type,e.customer_reported_received_at::date);
  SELECT * INTO sim FROM public.shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  confirmed:=elig->>'eligible'='eligible' AND ((sim.delivered_at IS NOT NULL AND sim.delivered_at<=now() AND sim.delivered_source='carrier') OR (e.delivered_source='customer_informed' AND e.customer_reported_received_at IS NOT NULL AND elig->>'delivered_source'='customer_informed'));
  guaranteed:=e.status='aprovado' AND public.central_ship_guarantee(s.id) IS NOT NULL;
  IF NOT confirmed AND NOT guaranteed THEN RETURN jsonb_build_object('ok',false,'error','Prazo de entrega ou envio não confirmado'); END IF;
  IF e.is_test THEN td:=NULL;
  ELSIF e.trocas_devolucoes_id IS NOT NULL THEN td:=e.trocas_devolucoes_id;
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
  sa:=coalesce(s.shipping_address,'{}'::jsonb); k:='central-'||e.id::text;
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

CREATE OR REPLACE FUNCTION public.central_context(p_hash text, p_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; e jsonb; s record; items jsonb; progress jsonb; trusted boolean; req boolean; simulation jsonb; g timestamptz; needs_date boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  e:=check_exchange_eligibility(l.order_ref,p_type);
  IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
  SELECT id,customer_name,created_at,shipped_at INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid;
  SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
  g:=public.central_ship_guarantee(s.id);
  needs_date:=e->>'reason'='sem_data_de_entrega' AND s.shipped_at IS NOT NULL AND now()>s.shipped_at+interval '7 days';
  SELECT test_simulation INTO simulation FROM exchange_requests WHERE id=l.submitted_request_id AND is_test;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'item_id',r.original_item_id,'item_name',r.product_name,'item_size',r.product_size,'status',r.status,'type',r.request_type,'reason',r.escalated_reason,'created_at',r.created_at,
    'reverse_code',coalesce(nullif(r.reverse_shipping_code,''),rv.codigo_objeto),'reverse_valid_until',rv.valid_until) ORDER BY r.created_at),'[]') INTO progress
  FROM exchange_requests r LEFT JOIN correios_reverse_shipments rv ON rv.id=r.reverse_shipment_id AND coalesce(rv.status,'') NOT IN ('cancelada','cancelado','erro')
  WHERE r.sale_id=s.id AND (r.id=l.submitted_request_id OR r.status NOT IN ('concluido','cancelado','recusado'));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'size',i.size,'quantity',i.quantity,
    'open',EXISTS(SELECT 1 FROM exchange_requests x WHERE x.sale_id=s.id AND x.status NOT IN ('concluido','cancelado','recusado') AND (x.original_item_id=i.id OR x.original_item_id IS NULL AND x.product_sku=i.sku))
    OR EXISTS(SELECT 1 FROM trocas_devolucoes t JOIN public.trocas_devolucoes_itens ti ON ti.troca_devolucao_id=t.id AND ti.direcao='devolvido' WHERE t.pedido_original_id=s.id AND t.status NOT IN ('concluida','cancelada') AND (ti.sku=i.sku OR ti.barcode IS NOT NULL AND ti.barcode=i.barcode))) ORDER BY i.created_at,i.id),'[]') INTO items
  FROM pos_sale_items i WHERE i.sale_id=s.id;
  RETURN jsonb_build_object('first_name',split_part(trim(coalesce(s.customer_name,'Cliente')),' ',1),'items',items,'purchased_at',s.created_at,
    'shipped_at',s.shipped_at,'delivered_at',e->'delivered_at','deadline_at',coalesce(e->'deadline_at',to_jsonb(g)),
    'eligibility',CASE WHEN e->>'eligible'='eligible' AND trusted IS TRUE OR g IS NOT NULL THEN 'eligible' ELSE 'needs_human' END,
    'requires_received_date',needs_date,'received_date_min',CASE WHEN needs_date THEN (s.shipped_at AT TIME ZONE 'America/Sao_Paulo')::date END,
    'received_date_max',CASE WHEN needs_date THEN least(((s.shipped_at+interval '10 days') AT TIME ZONE 'America/Sao_Paulo')::date,(now() AT TIME ZONE 'America/Sao_Paulo')::date) END,
    'used',l.used_at IS NOT NULL,'progress',progress,'type',p_type,'require_product_choice',CASE WHEN p_type='troca' THEN req ELSE false END,
    'is_test',l.is_test,'test_simulation',simulation);
END $$;
REVOKE EXECUTE ON FUNCTION public.central_context(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_context(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text, p_type text, p_item uuid, p_quantity integer, p_reason text, p_detail text, p_replacement uuid, p_unused boolean, p_desired text, p_received_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; e jsonb; s record; i record; p record; found_id uuid; td record; qty numeric; approved boolean; trusted boolean; reported boolean; why text; rid uuid; newsku text; newsize text; req boolean; wish text; g timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  wish:=nullif(trim(coalesce(p_desired,'')),'');
  IF p_type NOT IN ('troca','devolucao') OR p_reason NOT IN ('tamanho','defeito','nao_gostou','produto_errado','outro') OR p_quantity IS NULL OR p_quantity<1 OR p_quantity>100 OR length(coalesce(p_detail,''))>1000 OR length(trim(coalesce(p_detail,'')))<3 OR p_type='devolucao' AND p_replacement IS NOT NULL OR length(coalesce(wish,''))>200 THEN RETURN jsonb_build_object('error','Confira os dados da solicitação.'); END IF;
  IF p_type='devolucao' THEN wish:=NULL; END IF;
  SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
  IF p_type='troca' AND NOT req THEN p_replacement:=NULL; ELSE wish:=NULL; END IF;
  SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  e:=check_exchange_eligibility(l.order_ref,p_type,p_received_date);
  IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid FOR UPDATE;
  SELECT * INTO i FROM pos_sale_items WHERE id=p_item AND sale_id=s.id;
  IF NOT FOUND OR p_quantity>i.quantity THEN RETURN jsonb_build_object('error','Confira o item e a quantidade.'); END IF;
  SELECT id INTO found_id FROM exchange_requests WHERE sale_id=s.id AND status NOT IN ('concluido','cancelado','recusado') AND (original_item_id=i.id OR original_item_id IS NULL AND product_sku=i.sku) ORDER BY created_at LIMIT 1;
  IF found_id IS NOT NULL THEN RETURN jsonb_build_object('id',found_id,'existing',true); END IF;
  SELECT t.id,t.codigo_devolucao INTO td FROM trocas_devolucoes t JOIN trocas_devolucoes_itens ti ON ti.troca_devolucao_id=t.id AND ti.direcao='devolvido' WHERE t.pedido_original_id=s.id AND t.status NOT IN ('concluida','cancelada') AND (ti.sku=i.sku OR ti.barcode IS NOT NULL AND ti.barcode=i.barcode) LIMIT 1;
  IF td.id IS NOT NULL THEN RETURN jsonb_build_object('existing',true,'legacy_code',td.codigo_devolucao,'status','em_andamento'); END IF;
  SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  reported:=e->>'eligible'='eligible' AND e->>'delivered_source'='customer_informed';
  g:=CASE WHEN trusted IS TRUE OR reported THEN NULL ELSE public.central_ship_guarantee(s.id) END;
  approved:=coalesce((e->>'eligible'='eligible' AND (trusted IS TRUE OR reported) OR g IS NOT NULL) AND p_unused IS TRUE AND p_reason IN ('tamanho','nao_gostou') AND s.status_cancelamento IS DISTINCT FROM 'cancelado' AND s.status NOT IN ('cancelled','refunded'),false);
  why:=CASE WHEN e->>'reason'='data_informada_invalida' THEN 'A data informada precisa ser analisada por um atendente.' WHEN trusted IS NOT TRUE AND NOT reported AND g IS NULL THEN 'Informe a data em que você recebeu o produto; fora do período aceito, um atendente vai analisar.' WHEN e->>'eligible'<>'eligible' AND g IS NULL THEN 'O prazo precisa ser analisado por um atendente.' WHEN NOT p_unused OR p_reason NOT IN ('tamanho','nao_gostou') THEN 'Um atendente precisa conferir o motivo e as condições do produto.' ELSE 'Precisamos conferir a situação do pedido.' END;
  IF p_type='troca' AND req THEN
    IF p_replacement IS NULL THEN approved:=false; why:='Um atendente ajudará a escolher o produto da troca.';
    ELSE
      SELECT * INTO p FROM pos_products WHERE id=p_replacement FOR UPDATE;
      IF NOT FOUND OR p.store_id IS DISTINCT FROM s.store_id THEN RETURN jsonb_build_object('error','Este produto não está disponível. Escolha novamente.'); END IF;
      SELECT coalesce(sum(replacement_reserved_quantity),0) INTO qty FROM exchange_requests WHERE replacement_product_id=p.id AND status NOT IN ('concluido','cancelado','recusado');
      IF p.stock-qty<p_quantity AND get_restock_mode(p.sku)='nao_oferecer' THEN RETURN jsonb_build_object('error','Este tamanho acabou. Escolha outra opção ou peça ajuda ao atendente.'); END IF;
      IF p.stock-qty<p_quantity OR p.price IS DISTINCT FROM i.unit_price THEN approved:=false; why:='A disponibilidade ou a diferença entre os produtos precisa de conferência da equipe.'; END IF;
      newsku:=p.sku; newsize:=p.size;
    END IF;
  END IF;
  INSERT INTO exchange_requests(phone,customer_name,order_ref,sale_id,request_type,channel_origin,original_item_id,requested_quantity,product_name,product_sku,product_size,reason_category,customer_verbatim,status,auto_approved,requires_human_review,escalated_reason,eligibility,eligibility_reason,delivered_at_used,delivered_source,deadline_at,replacement_product_id,new_sku,new_variant_id,desired_size,replacement_reserved_quantity,customer_product_request,customer_reported_received_at)
  VALUES(coalesce(s.customer_phone,l.customer_phone,''),s.customer_name,l.order_ref,s.id,p_type,'site',i.id,p_quantity,i.product_name,i.sku,i.size,p_reason::exchange_reason_category,p_detail,
    CASE WHEN approved THEN 'aprovado'::exchange_status ELSE 'escalado'::exchange_status END,approved,NOT approved,
    CASE WHEN approved AND p_type='troca' AND NOT req THEN 'Produto novo a separar' WHEN NOT approved THEN why END,
    CASE WHEN approved THEN 'eligible' ELSE 'needs_human' END,
    CASE WHEN reported THEN 'Data informada pela cliente' WHEN approved AND g IS NOT NULL THEN 'Prazo garantido pela data de envio (envio + 7 dias)' WHEN approved AND p_type='troca' AND NOT req THEN 'Produto novo a separar' ELSE why END,
    (e->>'delivered_at')::timestamptz,CASE WHEN trusted THEN 'carrier' WHEN reported THEN 'customer_informed' ELSE NULL END,coalesce((e->>'deadline_at')::timestamptz,g),
    p_replacement,newsku,p_replacement::text,newsize,CASE WHEN p_replacement IS NOT NULL THEN p_quantity ELSE 0 END,wish,
    CASE WHEN reported THEN (p_received_date::timestamp AT TIME ZONE 'America/Sao_Paulo') END) RETURNING id INTO rid;
  IF l.is_test THEN UPDATE exchange_requests SET is_test=true WHERE id=rid; END IF;
  UPDATE support_links SET used_at=coalesce(used_at,now()),submitted_request_id=coalesce(submitted_request_id,rid) WHERE id=l.id;
  RETURN jsonb_build_object('id',rid,'status',CASE WHEN approved THEN 'aprovado' ELSE 'escalado' END,'reason',CASE WHEN NOT approved THEN why WHEN p_type='troca' AND NOT req THEN 'Produto novo a separar' END,'existing',false);
END $$;
REVOKE ALL ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text,date) TO service_role;
COMMENT ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) IS 'DEPRECATED: use the overload with p_received_date; retained for backward compatibility.';