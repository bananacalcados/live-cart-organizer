-- 1) Data de envio real
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS shipped_source text;
ALTER TABLE public.pos_sales DROP CONSTRAINT IF EXISTS pos_sales_shipped_source_chk;
ALTER TABLE public.pos_sales ADD CONSTRAINT pos_sales_shipped_source_chk CHECK (shipped_source IS NULL OR shipped_source IN ('expedicao','transportadora'));
COMMENT ON COLUMN public.pos_sales.shipped_source IS 'Origem de shipped_at: expedicao (conclusão do despacho) ou transportadora (1º evento real de postagem/coleta)';

CREATE OR REPLACE FUNCTION public.first_carrier_event_at(p_events jsonb) RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT min((e->>'at')::timestamptz) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_events)='array' THEN p_events ELSE '[]'::jsonb END) e
  WHERE coalesce(e->>'at','') ~ '^\d{4}-\d{2}-\d{2}'
    AND coalesce(e->>'description','') !~* '(etiqueta|arquivo recebido|aguardando (coleta|postagem|retirada)|coleta dispon|in[ií]cio de coleta|pr[eé].?postagem|pedido (criado|recebido)|informa[cç][oõ]es (eletr[oô]nicas )?enviadas|objeto ainda n[aã]o)'
$$;
REVOKE ALL ON FUNCTION public.first_carrier_event_at(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.first_carrier_event_at(jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pos_sales_release_on_expedition()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sale_released_at IS NULL
       AND (COALESCE(NEW.sale_type, '') NOT IN ('live','online')
            OR COALESCE(NEW.expedition_stage, '') = 'concluido') THEN
      NEW.sale_released_at := now();
    END IF;
    IF COALESCE(NEW.expedition_stage,'')='concluido' AND NEW.shipped_at IS NULL AND COALESCE(NEW.sale_type,'') IN ('live','online') AND NOT COALESCE(NEW.is_store_pickup,false) THEN
      NEW.shipped_at := now(); NEW.shipped_source := 'expedicao';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.expedition_stage, '') = 'concluido'
     AND COALESCE(OLD.expedition_stage, '') <> 'concluido' THEN
    IF NEW.sale_released_at IS NULL THEN
      NEW.sale_released_at := now();
    END IF;
    IF NEW.shipped_at IS NULL AND COALESCE(NEW.sale_type,'') IN ('live','online') AND NOT COALESCE(NEW.is_store_pickup,false) THEN
      NEW.shipped_at := now(); NEW.shipped_source := 'expedicao';
    END IF;
  ELSIF COALESCE(OLD.expedition_stage, '') = 'concluido'
        AND COALESCE(NEW.expedition_stage, '') <> 'concluido' THEN
    NEW.sale_released_at := NULL;
    IF NEW.shipped_source = 'expedicao' THEN NEW.shipped_at := NULL; NEW.shipped_source := NULL; END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shipment_carrier_shipped_at() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v timestamptz;
BEGIN
  v := public.first_carrier_event_at(NEW.real_events);
  IF v IS NULL OR v > now() + interval '1 day' THEN RETURN NEW; END IF;
  UPDATE public.pos_sales p SET shipped_at = v, shipped_source = 'transportadora'
   WHERE p.id IN (SELECT x.sale_id FROM public.shipment_simulations x WHERE (x.id = NEW.id OR x.merged_into_id = NEW.id) AND x.sale_id IS NOT NULL)
     AND (p.shipped_at IS DISTINCT FROM v OR p.shipped_source IS DISTINCT FROM 'transportadora');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.shipment_carrier_shipped_at() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_shipment_carrier_shipped_at ON public.shipment_simulations;
CREATE TRIGGER trg_shipment_carrier_shipped_at AFTER INSERT OR UPDATE OF real_events ON public.shipment_simulations
  FOR EACH ROW WHEN (NEW.real_events IS NOT NULL AND NEW.sale_id IS NOT NULL) EXECUTE FUNCTION public.shipment_carrier_shipped_at();

-- 4) Rastreio colado como link
CREATE OR REPLACE FUNCTION public.parse_tracking_input(p_input text, OUT code text, OUT carrier text, OUT url text) LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE t text := trim(coalesce(p_input,'')); m text[]; pfx text;
BEGIN
  code := nullif(t,''); carrier := NULL; url := NULL;
  IF t = '' OR t !~ '/' THEN RETURN; END IF;
  IF t ~* '^https?://' THEN url := t; END IF;
  IF t ~* 'bananacalcados' THEN code := NULL; url := NULL; RETURN; END IF;
  m := regexp_match(t, '(?:^|/)(COR|JTE|JAD|LOG|JNT|TNT|AZU|BUS)/([A-Za-z0-9]+)', 'i');
  IF m IS NOT NULL THEN
    pfx := upper(m[1]); code := upper(m[2]);
    carrier := CASE pfx WHEN 'COR' THEN 'Correios' WHEN 'JTE' THEN 'J&T Express' WHEN 'JNT' THEN 'J&T Express' WHEN 'JAD' THEN 'Jadlog' WHEN 'LOG' THEN 'Loggi' WHEN 'AZU' THEN 'Azul Cargo' WHEN 'BUS' THEN 'Buslog' ELSE NULL END;
    RETURN;
  END IF;
  m := regexp_match(t, '([A-Za-z]{2}[0-9]{9}BR)', 'i');
  IF m IS NOT NULL THEN code := upper(m[1]); carrier := 'Correios'; RETURN; END IF;
  IF t ~* 'jtexpress|jet\.com' THEN m := regexp_match(t, '([0-9]{12,16})'); IF m IS NOT NULL THEN code := m[1]; carrier := 'J&T Express'; RETURN; END IF; END IF;
  IF t ~* 'jadlog' THEN m := regexp_match(t, '(?:cte|codigo|pedido|tracking)=?([0-9]{8,16})', 'i'); IF m IS NULL THEN m := regexp_match(t, '([0-9]{8,16})'); END IF; IF m IS NOT NULL THEN code := m[1]; carrier := 'Jadlog'; RETURN; END IF; END IF;
  m := regexp_match(t, '^/([0-9]{8,16})/?$');
  IF m IS NOT NULL THEN code := m[1]; RETURN; END IF;
  code := NULL; url := NULL;
END $$;
REVOKE ALL ON FUNCTION public.parse_tracking_input(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.parse_tracking_input(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pos_sales_normalize_tracking() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.parse_tracking_input(NEW.tracking_code);
  IF r.code IS NULL OR r.code = NEW.tracking_code THEN RETURN NEW; END IF;
  NEW.tracking_code := r.code;
  IF nullif(trim(coalesce(NEW.tracking_carrier,'')),'') IS NULL AND r.carrier IS NOT NULL THEN NEW.tracking_carrier := r.carrier; END IF;
  IF nullif(trim(coalesce(NEW.tracking_url,'')),'') IS NULL AND r.url IS NOT NULL THEN NEW.tracking_url := r.url; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pos_sales_normalize_tracking() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_pos_sales_normalize_tracking ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_normalize_tracking BEFORE INSERT OR UPDATE OF tracking_code ON public.pos_sales
  FOR EACH ROW WHEN (NEW.tracking_code ~ '/') EXECUTE FUNCTION public.pos_sales_normalize_tracking();

-- 2) Prazo garantido pela data de envio
CREATE OR REPLACE FUNCTION public.central_ship_guarantee(p_sale uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT s.shipped_at + interval '7 days' FROM public.pos_sales s
  WHERE s.id = p_sale AND s.shipped_at IS NOT NULL AND s.shipped_at <= now() AND now() <= s.shipped_at + interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.shipment_simulations x WHERE x.sale_id = s.id AND x.merged_into_id IS NULL AND x.delivered_at IS NOT NULL AND x.delivered_source = 'carrier')
$$;
REVOKE ALL ON FUNCTION public.central_ship_guarantee(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_ship_guarantee(uuid) TO service_role;

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
  shipped:=s.shipped_at;
  confirmed:=elig->>'eligible'='eligible' AND sim.delivered_at IS NOT NULL AND sim.delivered_at<=now() AND sim.delivered_source='carrier';
  guaranteed:=e.status='aprovado' AND public.central_ship_guarantee(s.id) IS NOT NULL;
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

CREATE OR REPLACE FUNCTION public.central_context(p_hash text, p_type text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; e jsonb; s record; items jsonb; progress jsonb; trusted boolean; req boolean; simulation jsonb; g timestamptz;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now();
IF NOT FOUND THEN RETURN NULL; END IF;
e:=check_exchange_eligibility(l.order_ref,p_type);
IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
SELECT id,customer_name,created_at INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid;
SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
SELECT coalesce((SELECT central_require_product_choice FROM support_settings WHERE id=true),true) INTO req;
g:=public.central_ship_guarantee(s.id);
SELECT test_simulation INTO simulation FROM exchange_requests WHERE id=l.submitted_request_id AND is_test;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'item_id',r.original_item_id,'item_name',r.product_name,'item_size',r.product_size,'status',r.status,'type',r.request_type,'reason',r.escalated_reason,'created_at',r.created_at,
  'reverse_code',coalesce(nullif(r.reverse_shipping_code,''),rv.codigo_objeto),'reverse_valid_until',rv.valid_until) ORDER BY r.created_at),'[]') INTO progress
FROM exchange_requests r LEFT JOIN correios_reverse_shipments rv ON rv.id=r.reverse_shipment_id AND coalesce(rv.status,'') NOT IN ('cancelada','cancelado','erro')
WHERE r.sale_id=s.id AND (r.id=l.submitted_request_id OR r.status NOT IN ('concluido','cancelado','recusado'));
SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'size',i.size,'quantity',i.quantity,
  'open',EXISTS(SELECT 1 FROM exchange_requests x WHERE x.sale_id=s.id AND x.status NOT IN ('concluido','cancelado','recusado') AND (x.original_item_id=i.id OR x.original_item_id IS NULL AND x.product_sku=i.sku))
  OR EXISTS(SELECT 1 FROM trocas_devolucoes t JOIN public.trocas_devolucoes_itens ti ON ti.troca_devolucao_id=t.id AND ti.direcao='devolvido' WHERE t.pedido_original_id=s.id AND t.status NOT IN ('concluida','cancelada') AND (ti.sku=i.sku OR ti.barcode IS NOT NULL AND ti.barcode=i.barcode))) ORDER BY i.created_at,i.id),'[]') INTO items
FROM pos_sale_items i WHERE i.sale_id=s.id;
RETURN jsonb_build_object('first_name',split_part(trim(coalesce(s.customer_name,'Cliente')),' ',1),'items',items,'purchased_at',s.created_at,'delivered_at',e->'delivered_at','deadline_at',coalesce(e->'deadline_at',to_jsonb(g)),'eligibility',CASE WHEN e->>'eligible'='eligible' AND trusted IS TRUE OR g IS NOT NULL THEN 'eligible' ELSE 'needs_human' END,'used',l.used_at IS NOT NULL,'progress',progress,'type',p_type,'require_product_choice',CASE WHEN p_type='troca' THEN req ELSE false END,'is_test',l.is_test,'test_simulation',simulation);
END $$;
REVOKE EXECUTE ON FUNCTION public.central_context(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_context(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text, p_type text, p_item uuid, p_quantity integer, p_reason text, p_detail text, p_replacement uuid, p_unused boolean, p_desired text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; e jsonb; s record; i record; p record; found_id uuid; td record; qty numeric; approved boolean; trusted boolean; why text; rid uuid; newsku text; newsize text; req boolean; wish text; g timestamptz;
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
g:=CASE WHEN trusted IS TRUE THEN NULL ELSE public.central_ship_guarantee(s.id) END;
approved:=coalesce((e->>'eligible'='eligible' AND trusted IS TRUE OR g IS NOT NULL) AND p_unused IS TRUE AND p_reason IN ('tamanho','nao_gostou') AND s.status_cancelamento IS DISTINCT FROM 'cancelado' AND s.status NOT IN ('cancelled','refunded'),false);
why:=CASE WHEN trusted IS NOT TRUE AND g IS NULL THEN 'Ainda precisamos confirmar a data de entrega com a transportadora.' WHEN e->>'eligible'<>'eligible' AND g IS NULL THEN 'O prazo precisa ser analisado por um atendente.' WHEN NOT p_unused OR p_reason NOT IN ('tamanho','nao_gostou') THEN 'Um atendente precisa conferir o motivo e as condições do produto.' ELSE 'Precisamos conferir a situação do pedido.' END;
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
VALUES(coalesce(s.customer_phone,l.customer_phone,''),s.customer_name,l.order_ref,s.id,p_type,'site',i.id,p_quantity,i.product_name,i.sku,i.size,p_reason::exchange_reason_category,p_detail,CASE WHEN approved THEN 'aprovado'::exchange_status ELSE 'escalado'::exchange_status END,approved,NOT approved,CASE WHEN NOT approved THEN why END,CASE WHEN approved THEN 'eligible' ELSE 'needs_human' END,CASE WHEN approved AND g IS NOT NULL THEN 'Prazo garantido pela data de envio (envio + 7 dias)' ELSE why END,(e->>'delivered_at')::timestamptz,CASE WHEN trusted IS TRUE THEN 'carrier' ELSE NULL END,coalesce((e->>'deadline_at')::timestamptz,g),p_replacement,newsku,p_replacement::text,newsize,CASE WHEN p_replacement IS NOT NULL THEN p_quantity ELSE 0 END,wish) RETURNING id INTO rid;
IF l.is_test THEN UPDATE exchange_requests SET is_test=true WHERE id=rid; END IF;
UPDATE support_links SET used_at=coalesce(used_at,now()),submitted_request_id=coalesce(submitted_request_id,rid) WHERE id=l.id;
RETURN jsonb_build_object('id',rid,'status',CASE WHEN approved THEN 'aprovado' ELSE 'escalado' END,'reason',CASE WHEN NOT approved THEN why END,'existing',false);
END $$;
REVOKE EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean,text) TO service_role;

-- 3) Cancelamento antes do envio
CREATE OR REPLACE FUNCTION public.refund_return_facts(p_source text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s uuid; o uuid; registered boolean; received boolean; note_ok boolean; active_exit boolean; old_exit boolean; shipped boolean; nd record; cancellable boolean;
BEGIN
 IF p_source='pos_sale' THEN SELECT id,source_order_id INTO s,o FROM public.pos_sales WHERE id=p_id;
 ELSIF p_source='order' THEN SELECT pos_sale_id,id INTO s,o FROM public.orders WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Origem inválida'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.trocas_devolucoes t WHERE t.pedido_original_id=s AND t.tipo='devolucao' AND t.status<>'cancelada'),
 EXISTS(SELECT 1 FROM public.trocas_devolucoes t WHERE t.pedido_original_id=s AND t.tipo='devolucao' AND t.status<>'cancelada' AND (t.status IN ('recebido_conferencia','concluida') OR EXISTS(SELECT 1 FROM public.trocas_devolucoes_itens i WHERE i.troca_devolucao_id=t.id AND i.direcao='devolvido' AND i.quantidade>0 AND i.estado_estoque IN ('retornado_vendavel','retornado_avaria')))),
 EXISTS(SELECT 1 FROM public.trocas_devolucoes t JOIN public.fiscal_documents f ON (f.troca_devolucao_id=t.id OR f.id=t.devolucao_doc_id) WHERE t.pedido_original_id=s AND t.tipo='devolucao' AND t.status<>'cancelada' AND (t.status IN ('recebido_conferencia','concluida') OR EXISTS(SELECT 1 FROM public.trocas_devolucoes_itens i WHERE i.troca_devolucao_id=t.id AND i.direcao='devolvido' AND i.quantidade>0 AND i.estado_estoque IN ('retornado_vendavel','retornado_avaria'))) AND f.finalidade=4 AND f.modelo=55 AND f.ambiente='producao' AND f.status IN ('authorized','pending','pending_sefaz')) INTO registered,received,note_ok;
 SELECT EXISTS(SELECT 1 FROM public.fiscal_documents f WHERE (f.pos_sale_id=s OR f.order_id=o) AND coalesce(f.finalidade,1)=1 AND f.ambiente='producao' AND f.status IN ('authorized','pending','pending_sefaz')),
 EXISTS(SELECT 1 FROM public.fiscal_documents f WHERE (f.pos_sale_id=s OR f.order_id=o) AND coalesce(f.finalidade,1)=1 AND f.status='authorized' AND f.data_autorizacao<now()-interval '24 hours') INTO active_exit,old_exit;
 SELECT f.id,f.modelo,f.numero,f.data_autorizacao INTO nd FROM public.fiscal_documents f WHERE (f.pos_sale_id=s OR f.order_id=o) AND coalesce(f.finalidade,1)=1 AND f.ambiente='producao' AND f.status='authorized' ORDER BY f.data_autorizacao DESC NULLS LAST LIMIT 1;
 cancellable:=nd.id IS NOT NULL AND nd.data_autorizacao IS NOT NULL AND now()<nd.data_autorizacao+CASE WHEN nd.modelo=65 THEN interval '30 minutes' ELSE interval '24 hours' END;
 SELECT coalesce(x.shipped_at IS NOT NULL OR coalesce(x.expedition_stage,'')='concluido',false) INTO shipped FROM public.pos_sales x WHERE x.id=s;
 IF p_source='order' THEN shipped:=coalesce(shipped,false) OR EXISTS(SELECT 1 FROM public.orders WHERE id=o AND stage IN ('shipped','delivered')); END IF;
 RETURN jsonb_build_object('sale_id',s,'registered',registered,'received',received,'return_note_ready',note_ok,'active_sale_note',active_exit,'sale_note_over_24h',old_exit,
   'shipped',coalesce(shipped,false),'sale_note_cancellable',coalesce(cancellable,false),'sale_note_id',nd.id,'sale_note_modelo',nd.modelo,'sale_note_numero',nd.numero,'sale_note_authorized_at',nd.data_autorizacao);
END $$;
REVOKE ALL ON FUNCTION public.refund_return_facts(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refund_return_facts(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_refund_return_fiscal() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE f jsonb; blocked boolean; actor uuid;
BEGIN
 f:=public.refund_return_facts(NEW.source,NEW.source_id);
 blocked:=CASE WHEN NEW.reason='devolucao' THEN NOT ((f->>'registered')::boolean AND (f->>'received')::boolean AND (f->>'return_note_ready')::boolean)
   WHEN NEW.reason='cancelamento_antes_envio' THEN (f->>'shipped')::boolean OR ((f->>'active_sale_note')::boolean AND NOT ((f->>'registered')::boolean AND (f->>'return_note_ready')::boolean))
   ELSE false END;
 IF NEW.fiscal_override_by IS NOT NULL THEN
 actor:=coalesce(NEW.approved_by,NEW.manual_registered_by,NEW.requested_by);
 IF NEW.fiscal_override_by IS DISTINCT FROM actor OR NOT public.has_role(actor,'admin') OR length(trim(coalesce(NEW.fiscal_override_reason,'')))<3 OR length(NEW.fiscal_override_reason)>500 THEN RAISE EXCEPTION 'Exceção fiscal exige administrador e justificativa de 3 a 500 caracteres'; END IF;
 NEW.fiscal_override_at:=coalesce(NEW.fiscal_override_at,now());
 ELSIF blocked THEN
 RAISE EXCEPTION 'Estorno bloqueado: pedido despachado é devolução; antes do envio, cancele a nota de venda (até 24h) ou, passado o prazo, só administrador com motivo';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_refund_return_fiscal() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_refund_return_fiscal() TO service_role;

-- Retroativo: rastreio salvo como link
UPDATE public.pos_sales SET tracking_code = tracking_code WHERE tracking_code ~ '/' AND (SELECT code FROM public.parse_tracking_input(tracking_code)) IS NOT NULL;

-- Retroativo: data de envio
WITH ev AS (
  SELECT x.sale_id, public.first_carrier_event_at(coalesce(m.real_events, x.real_events)) v
  FROM public.shipment_simulations x LEFT JOIN public.shipment_simulations m ON m.id = x.merged_into_id
  WHERE x.sale_id IS NOT NULL
), best AS (SELECT sale_id, min(v) v FROM ev WHERE v IS NOT NULL AND v <= now() + interval '1 day' GROUP BY sale_id)
UPDATE public.pos_sales p SET shipped_at = b.v, shipped_source = 'transportadora'
FROM best b WHERE p.id = b.sale_id AND coalesce(p.sale_type,'') IN ('live','online')
  AND (p.shipped_at IS DISTINCT FROM b.v OR p.shipped_source IS DISTINCT FROM 'transportadora');
UPDATE public.pos_sales p SET shipped_at = p.expedition_finished_at, shipped_source = 'expedicao'
WHERE p.shipped_at IS NULL AND p.expedition_finished_at IS NOT NULL AND coalesce(p.expedition_stage,'')='concluido'
  AND coalesce(p.sale_type,'') IN ('live','online') AND NOT coalesce(p.is_store_pickup,false);
UPDATE public.pos_sales SET shipped_source = 'expedicao' WHERE shipped_at IS NOT NULL AND shipped_source IS NULL;