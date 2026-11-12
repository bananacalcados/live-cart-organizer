ALTER TABLE public.support_settings ALTER COLUMN central_auto_reverse SET DEFAULT true;
UPDATE public.support_settings SET central_auto_reverse=true WHERE id=true AND central_auto_reverse IS DISTINCT FROM true;

CREATE OR REPLACE FUNCTION public.central_reverse_prepare(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; s record; i record; pc record; sim record; elig jsonb; td uuid; k text; shipped timestamptz; sa jsonb; original_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM public.exchange_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Solicitação não encontrada'); END IF;
  IF e.reverse_shipping_code IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'existing',true,'reverse_code',e.reverse_shipping_code,'status','aguardando_postagem'); END IF;
  IF e.reverse_shipment_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'pending',true,'error','A reversa já existe e precisa ser revisada pela equipe'); END IF;
  IF e.is_test THEN RETURN jsonb_build_object('ok',false,'error','Solicitação de TESTE não gera reversa'); END IF;
  IF NOT coalesce((SELECT central_auto_reverse FROM public.support_settings WHERE id=true),false) THEN RETURN jsonb_build_object('ok',false,'skipped',true); END IF;
  SELECT * INTO s FROM public.pos_sales WHERE id=e.sale_id;
  IF NOT FOUND OR coalesce(s.sales_channel,'presencial') NOT IN ('site','live','link_online','whatsapp') THEN RETURN jsonb_build_object('ok',false,'error','Pedido online não confirmado'); END IF;
  SELECT * INTO i FROM public.pos_sale_items WHERE id=e.original_item_id AND sale_id=s.id;
  IF NOT FOUND OR e.requested_quantity<1 OR e.requested_quantity>i.quantity THEN RETURN jsonb_build_object('ok',false,'error','Item do pedido não confirmado'); END IF;
  IF EXISTS(SELECT 1 FROM public.exchange_requests x WHERE x.sale_id=s.id AND x.id<>e.id AND x.status NOT IN ('concluido','cancelado','recusado') AND (x.original_item_id=i.id OR x.original_item_id IS NULL AND x.product_sku=i.sku)) THEN RETURN jsonb_build_object('ok',false,'error','Já existe outra solicitação aberta para este item'); END IF;
  elig:=public.check_exchange_eligibility(e.order_ref,e.request_type);
  SELECT * INTO sim FROM public.shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  shipped:=coalesce(sim.posted_at,s.shipped_at,s.expedition_finished_at);
  IF NOT (elig->>'eligible'='eligible' AND sim.delivered_at IS NOT NULL AND sim.delivered_at<=now() AND sim.delivered_source='carrier')
     AND NOT (elig->>'delivered_at' IS NULL AND shipped IS NOT NULL AND shipped<=now() AND now()<=shipped+interval '7 days') THEN
    RETURN jsonb_build_object('ok',false,'error','Prazo de entrega ou envio não confirmado');
  END IF;
  IF e.trocas_devolucoes_id IS NOT NULL THEN
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
  RETURN jsonb_build_object('ok',true,'troca_id',td,'idempotency_key',k,'sale_id',s.id,'service_code','03301','reason',left(coalesce(e.reason_category::text,'outro'),200),
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

CREATE OR REPLACE FUNCTION public.central_reverse_finish(p_request_id uuid,p_reverse_id uuid,p_code text,p_valid_until date,p_error text,p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; rv uuid; wid uuid; oid uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM public.exchange_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  rv:=coalesce(p_reverse_id,e.reverse_shipment_id,(SELECT id FROM public.correios_reverse_shipments WHERE idempotency_key='central-'||p_request_id::text));
  IF p_code IS NOT NULL AND p_error IS NULL THEN
    IF p_code!~'^[A-Z]{2}[0-9]{9}[A-Z]{2}$' THEN RAISE EXCEPTION 'Código de postagem inválido'; END IF;
    UPDATE public.exchange_requests SET reverse_shipment_id=rv,reverse_shipping_code=p_code,status='aguardando_postagem',auto_approved=true,requires_human_review=false,escalated_reason=NULL,updated_at=now() WHERE id=e.id;
    UPDATE public.trocas_devolucoes SET codigo_postagem_reversa=p_code,status='aguardando_retorno',fase2_erro=NULL,updated_at=now() WHERE id=e.trocas_devolucoes_id;
    INSERT INTO public.exchange_request_events(request_id,actor_name,action,to_status,note) VALUES(e.id,'Central automática','reverse_created','aguardando_postagem','Reversa e nota de devolução criadas sem duplicidade');
    SELECT m.whatsapp_number_id INTO wid FROM public.whatsapp_messages m
      WHERE m.phone=e.phone AND m.whatsapp_number_id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529')
      ORDER BY m.created_at DESC LIMIT 1;
    wid:=coalesce(wid,'0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c');
    IF p_message IS NOT NULL THEN
      BEGIN
        INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key)
        VALUES(e.phone,wid,p_message,'central_auto','central-'||e.id::text) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO oid;
        SELECT id INTO oid FROM public.support_outbox WHERE idempotency_key='central-'||e.id::text;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.exchange_request_events(request_id,actor_name,action,note) VALUES(e.id,'Central automática','outbox_error',left(SQLERRM,800));
      END;
    END IF;
    RETURN jsonb_build_object('ok',true,'status','aguardando_postagem','reverse_code',p_code,'reverse_valid_until',p_valid_until,'outbox_id',oid);
  END IF;
  UPDATE public.exchange_requests SET reverse_shipment_id=rv,status='escalado',auto_approved=false,requires_human_review=true,escalated_reason=left(coalesce(nullif(p_error,''),'Não foi possível gerar a reversa automaticamente'),800),updated_at=now() WHERE id=e.id;
  INSERT INTO public.exchange_request_events(request_id,actor_name,action,to_status,reason) VALUES(e.id,'Central automática','reverse_failed','escalado',left(coalesce(p_error,'erro desconhecido'),800));
  RETURN jsonb_build_object('ok',false,'status','escalado');
END $$;
REVOKE ALL ON FUNCTION public.central_reverse_finish(uuid,uuid,text,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_reverse_finish(uuid,uuid,text,date,text,text) TO service_role;