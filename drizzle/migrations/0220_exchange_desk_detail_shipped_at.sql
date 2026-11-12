CREATE OR REPLACE FUNCTION public.exchange_desk_detail(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e record; s record; sim record; key8 text; r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id, store_id, customer_name, customer_phone, total, created_at, external_order_id, shipped_at, shipped_source INTO s FROM pos_sales WHERE id = e.sale_id;
  SELECT delivered_at, delivered_source, real_carrier INTO sim FROM shipment_simulations WHERE sale_id = e.sale_id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  key8 := right(regexp_replace(coalesce(e.phone,''),'\D','','g'), 8);
  r := jsonb_build_object(
    'request', to_jsonb(e),
    'sale', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'store_id',s.store_id,'store_name',(SELECT name FROM pos_stores WHERE id=s.store_id),'customer_name',s.customer_name,'customer_phone',s.customer_phone,'total',s.total,'created_at',s.created_at,'external_order_id',s.external_order_id,'shipped_at',s.shipped_at,'shipped_source',s.shipped_source) END,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_name',i.product_name,'size',i.size,'sku',i.sku,'barcode',i.barcode,'quantity',i.quantity,'unit_price',i.unit_price) ORDER BY i.created_at),'[]') FROM pos_sale_items i WHERE i.sale_id = e.sale_id),
    'delivery', jsonb_build_object('delivered_at', coalesce(e.delivered_at_used, sim.delivered_at), 'source', coalesce(e.delivered_source, sim.delivered_source), 'customer_reported_at', e.customer_reported_received_at, 'carrier', sim.real_carrier),
    'history', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at),'[]') FROM exchange_request_events h WHERE h.request_id = e.id),
    'previous', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'type',o.request_type,'status',o.status,'created_at',o.created_at,'product_name',o.product_name) ORDER BY o.created_at DESC),'[]') FROM (SELECT * FROM exchange_requests o WHERE o.id <> e.id AND length(key8)=8 AND right(regexp_replace(o.phone,'\D','','g'),8) = key8 ORDER BY o.created_at DESC LIMIT 20) o),
    'previous_legacy', (SELECT count(*) FROM trocas_devolucoes t JOIN pos_sales ps ON ps.id = t.pedido_original_id WHERE length(key8)=8 AND ps.phone_suffix8 = key8 AND (e.trocas_devolucoes_id IS NULL OR t.id <> e.trocas_devolucoes_id)),
    'nfe_devolucao', (SELECT jsonb_build_object('status',f.status,'numero',f.numero,'chave',f.chave_acesso) FROM fiscal_documents f WHERE e.trocas_devolucoes_id IS NOT NULL AND f.troca_devolucao_id = e.trocas_devolucoes_id AND f.finalidade = 4 ORDER BY f.created_at DESC LIMIT 1),
    'troca', (SELECT jsonb_build_object('id',t.id,'codigo',t.codigo_devolucao,'status',t.status,'codigo_postagem_reversa',t.codigo_postagem_reversa) FROM trocas_devolucoes t WHERE t.id = e.trocas_devolucoes_id),
    'replacement', (SELECT jsonb_build_object('id',p.id,'name',p.name,'size',p.size,'sku',p.sku,'barcode',p.barcode,'price',p.price) FROM pos_products p WHERE p.id = e.replacement_product_id)
  );
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.exchange_desk_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_detail(uuid) TO authenticated,service_role;