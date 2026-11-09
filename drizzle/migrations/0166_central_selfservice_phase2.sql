ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS central_auto_reverse boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS central_public_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_links ADD COLUMN IF NOT EXISTS submitted_request_id uuid;
ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS original_item_id uuid;
ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS requested_quantity integer DEFAULT 1;
ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS replacement_product_id uuid;
ALTER TABLE public.exchange_requests ADD COLUMN IF NOT EXISTS replacement_reserved_quantity integer DEFAULT 0;
ALTER TABLE public.product_restock_flags ADD COLUMN IF NOT EXISTS central_offer_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.product_restock_flags ALTER COLUMN restock_mode SET DEFAULT 'sob_consulta';
CREATE INDEX IF NOT EXISTS exchange_requests_central_item_idx ON public.exchange_requests(sale_id,original_item_id) WHERE original_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS exchange_requests_central_reserve_idx ON public.exchange_requests(replacement_product_id) WHERE replacement_product_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.get_restock_mode(p_sku text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
RETURN coalesce((SELECT restock_mode FROM product_restock_flags WHERE (sku=p_sku OR shopify_product_id=p_sku) AND central_offer_enabled ORDER BY (sku=p_sku) DESC LIMIT 1),'nao_oferecer'); END $$;
REVOKE ALL ON FUNCTION public.get_restock_mode(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_restock_mode(text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.central_context(p_hash text,p_type text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE l record; e jsonb; s record; items jsonb; progress jsonb; trusted boolean;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now();
IF NOT FOUND THEN RETURN NULL; END IF;
e:=check_exchange_eligibility(l.order_ref,p_type);
IF e->>'sale_id' IS NULL THEN RETURN NULL; END IF;
SELECT id,customer_name,created_at INTO s FROM pos_sales WHERE id=(e->>'sale_id')::uuid;
SELECT coalesce(delivered_source='carrier' AND delivered_at<=now(),false) INTO trusted FROM shipment_simulations WHERE sale_id=s.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'size',i.size,'quantity',i.quantity) ORDER BY i.created_at,i.id),'[]') INTO items FROM pos_sale_items i WHERE i.sale_id=s.id;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'item_id',r.original_item_id,'status',r.status,'type',r.request_type,'reason',r.escalated_reason,'created_at',r.created_at)),'[]') INTO progress FROM exchange_requests r WHERE r.sale_id=s.id AND (r.id=l.submitted_request_id OR r.status NOT IN ('concluido','cancelado','recusado'));
RETURN jsonb_build_object('first_name',split_part(trim(coalesce(s.customer_name,'Cliente')),' ',1),'items',items,'purchased_at',s.created_at,'delivered_at',e->'delivered_at','deadline_at',e->'deadline_at','eligibility',CASE WHEN e->>'eligible'='eligible' AND trusted IS TRUE THEN 'eligible' ELSE 'needs_human' END,'used',l.used_at IS NOT NULL,'progress',progress,'type',p_type);
END $$;
REVOKE ALL ON FUNCTION public.central_context(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_context(text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.central_options(p_hash text,p_type text,p_item uuid,p_search text DEFAULT '',p_limit integer DEFAULT 50,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE l record; e jsonb; i record; base record; result jsonb;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
IF p_type<>'troca' OR length(coalesce(p_search,''))>100 OR p_offset<0 OR p_offset>10000 THEN RETURN NULL; END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now() AND used_at IS NULL;
IF NOT FOUND THEN RETURN NULL; END IF;
e:=check_exchange_eligibility(l.order_ref,p_type);
SELECT * INTO i FROM pos_sale_items WHERE id=p_item AND sale_id=(e->>'sale_id')::uuid;
IF NOT FOUND THEN RETURN NULL; END IF;
SELECT * INTO base FROM pos_products WHERE store_id=(SELECT store_id FROM pos_sales WHERE id=i.sale_id) AND sku=i.sku ORDER BY id LIMIT 1;
IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.same_product DESC,x.in_stock DESC,x.name,x.size,x.id),'[]') INTO result FROM (
SELECT p.id,p.name,p.size,p.color,p.image_url,(p.stock-coalesce(res.qty,0)>0) AS in_stock,(p.parent_sku IS NOT NULL AND p.parent_sku=base.parent_sku OR p.name=base.name) AS same_product
FROM pos_products p LEFT JOIN LATERAL (SELECT sum(replacement_reserved_quantity) qty FROM exchange_requests r WHERE r.replacement_product_id=p.id AND r.status NOT IN ('concluido','cancelado','recusado')) res ON true
WHERE p.store_id=base.store_id AND (coalesce(p_search,'')='' AND (p.parent_sku=base.parent_sku OR p.name=base.name) OR length(p_search)>=3 AND p.name ILIKE '%'||p_search||'%')
AND (p.stock-coalesce(res.qty,0)>0 OR get_restock_mode(p.sku)<>'nao_oferecer')
ORDER BY (p.parent_sku IS NOT NULL AND p.parent_sku=base.parent_sku OR p.name=base.name) DESC,(p.stock-coalesce(res.qty,0)>0) DESC,p.name,p.size,p.id LIMIT least(greatest(p_limit,1),100) OFFSET p_offset) x;
RETURN result; END $$;
REVOKE ALL ON FUNCTION public.central_options(text,text,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_options(text,text,uuid,text,integer,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.central_submit_atomic(p_hash text,p_type text,p_item uuid,p_quantity integer,p_reason text,p_detail text,p_replacement uuid DEFAULT NULL,p_unused boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l record; e jsonb; s record; i record; p record; found_id uuid; td record; qty numeric; approved boolean; trusted boolean; why text; rid uuid; newsku text; newsize text;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
IF p_type NOT IN ('troca','devolucao') OR p_reason NOT IN ('tamanho','defeito','nao_gostou','produto_errado','outro') OR p_quantity IS NULL OR p_quantity<1 OR p_quantity>100 OR length(coalesce(p_detail,''))>1000 OR length(trim(coalesce(p_detail,'')))<3 OR p_type='devolucao' AND p_replacement IS NOT NULL THEN RETURN jsonb_build_object('error','Confira os dados da solicitação.'); END IF;
SELECT * INTO l FROM support_links WHERE token_hash=p_hash AND request_type=p_type AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
IF NOT FOUND THEN RETURN NULL; END IF;
IF l.used_at IS NOT NULL THEN RETURN jsonb_build_object('id',l.submitted_request_id,'existing',true); END IF;
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
IF p_replacement IS NULL THEN approved:=false; why:='Um atendente ajudará a escolher o produto da troca.';
ELSE
SELECT * INTO p FROM pos_products WHERE id=p_replacement FOR UPDATE;
IF NOT FOUND OR p.store_id IS DISTINCT FROM s.store_id THEN RETURN jsonb_build_object('error','Este produto não está disponível. Escolha novamente.'); END IF;
SELECT coalesce(sum(replacement_reserved_quantity),0) INTO qty FROM exchange_requests WHERE replacement_product_id=p.id AND status NOT IN ('concluido','cancelado','recusado');
IF p.stock-qty<p_quantity AND get_restock_mode(p.sku)='nao_oferecer' THEN RETURN jsonb_build_object('error','Este tamanho acabou. Escolha outra opção ou peça ajuda ao atendente.'); END IF;
IF p.stock-qty<p_quantity OR p.price IS DISTINCT FROM i.unit_price THEN approved:=false; why:='A disponibilidade ou a diferença entre os produtos precisa de conferência da equipe.'; END IF;
newsku:=p.sku; newsize:=p.size;
END IF; END IF;
INSERT INTO exchange_requests(phone,customer_name,order_ref,sale_id,request_type,channel_origin,original_item_id,requested_quantity,product_name,product_sku,product_size,reason_category,customer_verbatim,status,auto_approved,requires_human_review,escalated_reason,eligibility,eligibility_reason,delivered_at_used,delivered_source,deadline_at,replacement_product_id,new_sku,new_variant_id,desired_size,replacement_reserved_quantity)
VALUES(coalesce(s.customer_phone,l.customer_phone,''),s.customer_name,l.order_ref,s.id,p_type,'site',i.id,p_quantity,i.product_name,i.sku,i.size,p_reason::exchange_reason_category,p_detail,CASE WHEN approved THEN 'aprovado'::exchange_status ELSE 'escalado'::exchange_status END,approved,NOT approved,CASE WHEN NOT approved THEN why END,CASE WHEN approved THEN 'eligible' ELSE 'needs_human' END,why,(e->>'delivered_at')::timestamptz,CASE WHEN trusted IS TRUE THEN 'carrier' ELSE NULL END,(e->>'deadline_at')::timestamptz,p_replacement,newsku,p_replacement::text,newsize,CASE WHEN p_replacement IS NOT NULL THEN p_quantity ELSE 0 END) RETURNING id INTO rid;
UPDATE support_links SET used_at=now(),submitted_request_id=rid WHERE id=l.id;
RETURN jsonb_build_object('id',rid,'status',CASE WHEN approved THEN 'aprovado' ELSE 'escalado' END,'reason',CASE WHEN NOT approved THEN why END,'existing',false);
END $$;
REVOKE ALL ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_submit_atomic(text,text,uuid,integer,text,text,uuid,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.central_restock_list(p_search text DEFAULT '',p_limit integer DEFAULT 50,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
IF length(p_search)>100 OR p_offset<0 THEN RAISE EXCEPTION 'invalid'; END IF;
SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO result FROM (
SELECT p.id,p.sku,p.name,p.size,p.color,p.stock,coalesce(f.central_offer_enabled,false) enabled FROM pos_products p LEFT JOIN product_restock_flags f ON f.sku=p.sku
WHERE p.sku IS NOT NULL AND p.sku<>'' AND (p_search='' OR length(p_search)>=3 AND p.name ILIKE '%'||p_search||'%') ORDER BY p.name,p.sku,p.id LIMIT least(greatest(p_limit,1),100) OFFSET p_offset) x;
RETURN result; END $$;
REVOKE ALL ON FUNCTION public.central_restock_list(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.central_restock_list(text,integer,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.central_restock_set(p_skus text[],p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
IF coalesce(cardinality(p_skus),0)<1 OR cardinality(p_skus)>100 THEN RAISE EXCEPTION 'invalid'; END IF;
INSERT INTO product_restock_flags(sku,restock_mode,central_offer_enabled,updated_by) SELECT DISTINCT unnest(p_skus),'sob_consulta',p_enabled,auth.uid() ON CONFLICT(sku) DO UPDATE SET central_offer_enabled=excluded.central_offer_enabled,updated_by=excluded.updated_by,updated_at=now() WHERE product_restock_flags.central_offer_enabled IS DISTINCT FROM excluded.central_offer_enabled;
END $$;
REVOKE ALL ON FUNCTION public.central_restock_set(text[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.central_restock_set(text[],boolean) TO authenticated;