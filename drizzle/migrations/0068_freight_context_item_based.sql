CREATE OR REPLACE FUNCTION public.validate_freight_context(p_sale_id uuid,p_sale_ids uuid[],p_context jsonb) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE members uuid[]; current_group uuid; eligible integer; cur jsonb;
BEGIN
 PERFORM id FROM public.pos_sales WHERE id=ANY(p_sale_ids) ORDER BY id FOR UPDATE;
 SELECT expedition_group_id INTO current_group FROM public.pos_sales WHERE id=p_sale_id;
 IF current_group IS NULL THEN members:=ARRAY[p_sale_id]; ELSE SELECT array_agg(id ORDER BY id) INTO members FROM public.pos_sales WHERE expedition_group_id=current_group; END IF;
 IF members IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(p_sale_ids) v) THEN RAISE EXCEPTION 'Agrupamento mudou. Recote os fretes'; END IF;
 -- Item-based eligibility (expedition_stage summary is not authoritative); compare destination CEP only.
 SELECT count(*) INTO eligible FROM public.pos_sales s WHERE s.id=ANY(p_sale_ids) AND NOT coalesce(s.is_store_pickup,false) AND (coalesce(s.shipping_type,'') || ' ' || coalesce(s.shipping_carrier,'')) !~* 'retirada|pickup|motot[aá]xi' AND coalesce(s.expedition_group_id::text,'')=coalesce(p_context->>'group_id','')
   AND regexp_replace(coalesce(s.shipping_address->>'zip_code',s.shipping_address->>'zip',s.shipping_address->>'cep',s.shipping_address->>'postal_code',''),'\D','','g') = regexp_replace(coalesce(p_context->'address'->>'zip_code',p_context->'address'->>'zip',p_context->'address'->>'cep',p_context->'address'->>'postal_code',''),'\D','','g');
 IF eligible <> cardinality(p_sale_ids) THEN RAISE EXCEPTION 'Pedido/CEP/agrupamento mudou. Recote os fretes'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.expedition_conference_qty,'sku',i.sku,'barcode',i.barcode) ORDER BY i.id) INTO cur FROM public.pos_sale_items i WHERE i.sale_id=ANY(p_sale_ids) AND i.expedition_conference_qty>0;
 IF cur IS NULL THEN SELECT jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.quantity-coalesce(i.expedition_completed_qty,0),'sku',i.sku,'barcode',i.barcode) ORDER BY i.id) INTO cur FROM public.pos_sale_items i WHERE i.sale_id=ANY(p_sale_ids) AND i.quantity-coalesce(i.expedition_completed_qty,0)>0; END IF;
 IF cur IS NULL THEN SELECT jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.quantity,'sku',i.sku,'barcode',i.barcode) ORDER BY i.id) INTO cur FROM public.pos_sale_items i WHERE i.sale_id=ANY(p_sale_ids) AND i.quantity>0; END IF;
 IF p_context->'items' IS DISTINCT FROM cur THEN RAISE EXCEPTION 'Itens do pedido mudaram. Recote os fretes'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_freight_context(uuid,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_freight_context(uuid,uuid[],jsonb) TO service_role;