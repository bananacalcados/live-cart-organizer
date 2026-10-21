CREATE FUNCTION public.validate_freight_context(p_sale_id uuid,p_sale_ids uuid[],p_context jsonb) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE members uuid[]; current_group uuid; eligible integer;
BEGIN
 PERFORM id FROM public.pos_sales WHERE id=ANY(p_sale_ids) ORDER BY id FOR UPDATE;
 SELECT expedition_group_id INTO current_group FROM public.pos_sales WHERE id=p_sale_id;
 IF current_group IS NULL THEN members:=ARRAY[p_sale_id]; ELSE SELECT array_agg(id ORDER BY id) INTO members FROM public.pos_sales WHERE expedition_group_id=current_group; END IF;
 IF members IS DISTINCT FROM (SELECT array_agg(v ORDER BY v) FROM unnest(p_sale_ids) v) THEN RAISE EXCEPTION 'Agrupamento mudou. Recote os fretes'; END IF;
 SELECT count(*) INTO eligible FROM public.pos_sales s WHERE s.id=ANY(p_sale_ids) AND s.expedition_stage='conferencia' AND NOT coalesce(s.is_store_pickup,false) AND (coalesce(s.shipping_type,'') || ' ' || coalesce(s.shipping_carrier,'')) !~* 'retirada|pickup|motot[aá]xi' AND coalesce(s.expedition_group_id::text,'')=coalesce(p_context->>'group_id','') AND s.shipping_address IS NOT DISTINCT FROM p_context->'address';
 IF eligible <> cardinality(p_sale_ids) THEN RAISE EXCEPTION 'Pedido/endereço/agrupamento mudou. Recote os fretes'; END IF;
 IF p_context->'items' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.expedition_conference_qty,'sku',i.sku,'barcode',i.barcode) ORDER BY i.id) FROM public.pos_sale_items i WHERE i.sale_id=ANY(p_sale_ids) AND i.expedition_conference_qty>0) THEN RAISE EXCEPTION 'Itens da Conferência mudaram. Recote os fretes'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_freight_context(uuid,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_freight_context(uuid,uuid[],jsonb) TO service_role;
CREATE FUNCTION public.record_sale_freight_quote(p_sale_id uuid,p_sale_ids uuid[],p_package jsonb,p_options jsonb,p_errors jsonb,p_user_id uuid,p_context jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.sale_freight_quotes;
BEGIN
 IF cardinality(p_sale_ids)>100 OR NOT (public.has_role(p_user_id,'admin') OR public.has_module_access(p_user_id,'pos') OR public.has_module_access(p_user_id,'expedition')) THEN RAISE EXCEPTION 'Sem permissão ou grupo inválido'; END IF;
 PERFORM public.validate_freight_context(p_sale_id,p_sale_ids,p_context);
 INSERT INTO public.sale_freight_quotes(sale_id,sale_ids,package,options,errors,quoted_by,context) VALUES(p_sale_id,p_sale_ids,p_package,p_options,p_errors,p_user_id,p_context) RETURNING * INTO result;
 RETURN jsonb_build_object('id',result.id,'quoted_at',result.quoted_at);
END $$;
REVOKE ALL ON FUNCTION public.record_sale_freight_quote(uuid,uuid[],jsonb,jsonb,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_freight_quote(uuid,uuid[],jsonb,jsonb,jsonb,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.select_sale_freight_option(p_quote_id uuid,p_option_index integer,p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q public.sale_freight_quotes; opt jsonb; carrier_name text; carrier_type text;
BEGIN
 SELECT * INTO q FROM public.sale_freight_quotes WHERE id=p_quote_id;
 IF q.id IS NULL OR p_option_index<0 OR p_option_index>=jsonb_array_length(q.options) THEN RAISE EXCEPTION 'Cotação ou opção inválida'; END IF;
 IF NOT (public.has_role(p_user_id,'admin') OR public.has_module_access(p_user_id,'pos') OR public.has_module_access(p_user_id,'expedition')) THEN RAISE EXCEPTION 'Sem permissão para cotar fretes'; END IF;
 PERFORM public.validate_freight_context(q.sale_id,q.sale_ids,q.context);
 SELECT * INTO q FROM public.sale_freight_quotes WHERE id=p_quote_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.sale_freight_quotes newer WHERE newer.sale_id=q.sale_id AND (newer.quoted_at,newer.id)>(q.quoted_at,q.id)) THEN RAISE EXCEPTION 'Há uma cotação mais recente. Recarregue'; END IF;
 opt:=q.options->p_option_index; carrier_name:=opt->>'shipping_carrier'; carrier_type:=opt->>'shipping_type';
 IF carrier_name IS NULL OR carrier_type NOT IN ('correios','transportadora') THEN RAISE EXCEPTION 'Opção inválida'; END IF;
 UPDATE public.sale_freight_quotes SET selected_option=opt WHERE id=q.id AND selected_option IS DISTINCT FROM opt;
 UPDATE public.pos_sales SET shipping_carrier=carrier_name,shipping_type=carrier_type WHERE id=ANY(q.sale_ids) AND (shipping_carrier IS DISTINCT FROM carrier_name OR shipping_type IS DISTINCT FROM carrier_type);
 RETURN opt;
END $$;
REVOKE ALL ON FUNCTION public.select_sale_freight_option(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.select_sale_freight_option(uuid,integer,uuid) TO service_role;