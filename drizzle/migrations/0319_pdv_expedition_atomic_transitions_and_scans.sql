-- NÃO REMOVER: locks precede every check/item write; legacy columns and trigger paths stay identical.
CREATE OR REPLACE FUNCTION public.pos_expedition_transition(p_orders jsonb,p_mode text,p_target text DEFAULT NULL,p_items jsonb DEFAULT '[]',p_shipping jsonb DEFAULT '{}',p_finished_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ids uuid[]; locked public.pos_sales%rowtype; wanted jsonb; item jsonb; actual public.pos_sale_items%rowtype; all_done boolean; has_check boolean; has_wait boolean; summary text;
BEGIN
IF NOT public.is_team_member((SELECT auth.uid())) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
IF jsonb_typeof(p_orders)<>'array' OR jsonb_array_length(p_orders) NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>200 THEN RAISE EXCEPTION 'Lote inválido'; END IF;
IF p_mode NOT IN ('advance','items','waiting','finish','back','bulk_back') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
IF p_mode<>'finish' AND (p_target IS NULL OR p_target NOT IN ('novo','preparacao','separacao','aguardando','conferencia','concluido')) THEN RAISE EXCEPTION 'Etapa inválida'; END IF;
SELECT array_agg(DISTINCT (o->>'id')::uuid ORDER BY (o->>'id')::uuid) INTO ids FROM jsonb_array_elements(p_orders) o;
IF cardinality(ids)<>jsonb_array_length(p_orders) OR (SELECT count(DISTINCT i->>'id') FROM jsonb_array_elements(p_items) i)<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Pedidos ou itens duplicados'; END IF;
FOR locked IN SELECT * FROM public.pos_sales WHERE id=ANY(ids) ORDER BY id FOR UPDATE LOOP
SELECT o INTO wanted FROM jsonb_array_elements(p_orders) o WHERE (o->>'id')::uuid=locked.id;
IF locked.expedition_stage IS DISTINCT FROM wanted->>'stage' OR (wanted->>'updated_at' IS NOT NULL AND locked.updated_at IS DISTINCT FROM (wanted->>'updated_at')::timestamptz) THEN RAISE EXCEPTION 'Já foi movido por outra pessoa' USING ERRCODE='40001'; END IF;
IF p_mode='advance' AND locked.expedition_stage='novo' AND coalesce(locked.payment_details->>'is_avulso','false')='true' AND coalesce(locked.payment_details->>'avulso_completed','false')<>'true' THEN RAISE EXCEPTION 'Complete o pedido avulso na versão completa'; END IF;
END LOOP;
IF (SELECT count(*) FROM public.pos_sales WHERE id=ANY(ids))<>cardinality(ids) THEN RAISE EXCEPTION 'Pedido inexistente ou sem permissão'; END IF;
FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
SELECT * INTO actual FROM public.pos_sale_items WHERE id=(item->>'id')::uuid AND sale_id=ANY(ids) FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Item não pertence ao pedido'; END IF;
IF actual.quantity IS DISTINCT FROM (item->>'total_qty')::numeric OR coalesce(actual.expedition_conference_qty,0)<>(item->>'conference')::numeric OR coalesce(actual.expedition_waiting_qty,0)<>(item->>'waiting')::numeric OR coalesce(actual.expedition_completed_qty,0)<>(item->>'completed')::numeric OR coalesce(actual.expedition_picked_qty,0)<>(item->>'picked')::numeric THEN RAISE EXCEPTION 'Já foi movido por outra pessoa' USING ERRCODE='40001'; END IF;
IF (item->>'qty')::numeric<0 OR (item->>'qty')::numeric>actual.quantity THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
END LOOP;
IF p_mode='finish' THEN
IF jsonb_array_length(p_items)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i WHERE coalesce((i->>'scanned')::boolean,false)=false OR coalesce((i->>'feet_ok')::boolean,false)=false) THEN RAISE EXCEPTION 'Bipe e confira todos os itens'; END IF;
IF coalesce(p_shipping->>'carrier','')='' THEN RAISE EXCEPTION 'Selecione a forma de envio'; END IF;
DELETE FROM public.pos_expedition_checks WHERE sale_id=ANY(ids);
INSERT INTO public.pos_expedition_checks(sale_id,sale_item_id,barcode,scanned,feet_ok,has_defect) SELECT actual.sale_id,actual.id,actual.barcode,(i->>'scanned')::boolean,(i->>'feet_ok')::boolean,coalesce((i->>'has_defect')::boolean,false) FROM jsonb_array_elements(p_items) i JOIN public.pos_sale_items actual ON actual.id=(i->>'id')::uuid;
FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
UPDATE public.pos_sale_items SET expedition_completed_qty=coalesce(expedition_completed_qty,0)+CASE WHEN coalesce(expedition_conference_qty,0)<>0 THEN expedition_conference_qty ELSE (item->>'qty')::numeric END,expedition_conference_qty=0 WHERE id=(item->>'id')::uuid;
END LOOP;
SELECT bool_and(coalesce(expedition_completed_qty,0)>=coalesce(quantity,0)),bool_or(coalesce(expedition_conference_qty,0)>0),bool_or(coalesce(expedition_waiting_qty,0)>0) INTO all_done,has_check,has_wait FROM public.pos_sale_items WHERE sale_id=ANY(ids);
summary:=CASE WHEN all_done THEN 'concluido' WHEN has_check THEN 'conferencia' WHEN has_wait THEN 'aguardando' ELSE 'separacao' END;
UPDATE public.pos_sales SET expedition_stage=summary,expedition_finished_at=CASE WHEN all_done THEN coalesce(p_finished_at,now()) ELSE NULL END,expedition_waiting_products=NOT all_done,shipping_carrier=p_shipping->>'carrier',tracking_carrier=p_shipping->>'tracking_carrier',tracking_code=nullif(btrim(p_shipping->>'tracking'),''),tracking_url=nullif(btrim(p_shipping->>'tracking_url'),''),delivery_days=nullif(btrim(p_shipping->>'delivery_days'),''),courier_name=nullif(btrim(p_shipping->>'courier'),'') WHERE id=ANY(ids);
RETURN jsonb_build_object('stage',summary,'allCompleted',all_done);
ELSIF p_mode IN ('items','waiting') THEN
FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
IF p_mode='waiting' THEN
UPDATE public.pos_sale_items SET expedition_waiting_qty=greatest(0,coalesce(expedition_waiting_qty,0)-(item->>'qty')::numeric),expedition_conference_qty=coalesce(expedition_conference_qty,0)+(item->>'qty')::numeric,expedition_picked_qty=coalesce(expedition_conference_qty,0)+(item->>'qty')::numeric+greatest(0,coalesce(expedition_waiting_qty,0)-(item->>'qty')::numeric)+coalesce(expedition_completed_qty,0) WHERE id=(item->>'id')::uuid;
ELSE
UPDATE public.pos_sale_items SET expedition_picked_qty=coalesce(expedition_conference_qty,0)+CASE WHEN p_target='conferencia' THEN (item->>'qty')::numeric ELSE 0 END+coalesce(expedition_waiting_qty,0)+CASE WHEN p_target='aguardando' THEN (item->>'qty')::numeric ELSE 0 END+coalesce(expedition_completed_qty,0),expedition_conference_qty=coalesce(expedition_conference_qty,0)+CASE WHEN p_target='conferencia' THEN (item->>'qty')::numeric ELSE 0 END,expedition_waiting_qty=coalesce(expedition_waiting_qty,0)+CASE WHEN p_target='aguardando' THEN (item->>'qty')::numeric ELSE 0 END WHERE id=(item->>'id')::uuid;
END IF; END LOOP;
UPDATE public.pos_sales SET expedition_stage=p_target WHERE id=ANY(ids);
UPDATE public.pos_sales s SET expedition_waiting_products=true WHERE s.id=ANY(ids) AND s.expedition_waiting_products=false AND EXISTS(SELECT 1 FROM public.pos_sale_items i WHERE i.sale_id=s.id AND coalesce(i.expedition_conference_qty,0)+coalesce(i.expedition_completed_qty,0)<coalesce(i.quantity,0));
UPDATE public.pos_sales s SET expedition_waiting_products=false WHERE s.id=ANY(ids) AND s.expedition_waiting_products=true AND NOT EXISTS(SELECT 1 FROM public.pos_sale_items i WHERE i.sale_id=s.id AND coalesce(i.expedition_conference_qty,0)+coalesce(i.expedition_completed_qty,0)<coalesce(i.quantity,0));
ELSIF p_mode='back' THEN
FOR wanted IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
IF wanted->>'stage'='aguardando' THEN
FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP UPDATE public.pos_sale_items SET expedition_waiting_qty=0,expedition_picked_qty=coalesce(expedition_conference_qty,0)+coalesce(expedition_completed_qty,0) WHERE id=(item->>'id')::uuid AND sale_id=(wanted->>'id')::uuid; END LOOP;
ELSIF p_target IN ('novo','preparacao','separacao') THEN UPDATE public.pos_sale_items SET expedition_conference_qty=0,expedition_waiting_qty=0,expedition_picked_qty=0 WHERE sale_id=(wanted->>'id')::uuid AND expedition_completed_qty=0; END IF; END LOOP;
IF p_target IN ('novo','preparacao','separacao') THEN UPDATE public.pos_sales SET expedition_stage=p_target,expedition_finished_at=NULL,expedition_waiting_products=false WHERE id=ANY(ids); ELSE UPDATE public.pos_sales SET expedition_stage=p_target,expedition_finished_at=NULL WHERE id=ANY(ids); END IF;
ELSIF p_mode='bulk_back' THEN UPDATE public.pos_sales SET expedition_stage=p_target,expedition_finished_at=NULL WHERE id=ANY(ids);
ELSIF p_target='concluido' THEN UPDATE public.pos_sales SET expedition_stage=p_target,expedition_finished_at=coalesce(p_finished_at,now()) WHERE id=ANY(ids);
ELSE UPDATE public.pos_sales SET expedition_stage=p_target WHERE id=ANY(ids); END IF;
RETURN jsonb_build_object('stage',p_target);
END; $$;
REVOKE ALL ON FUNCTION public.pos_expedition_transition(jsonb,text,text,jsonb,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pos_expedition_transition(jsonb,text,text,jsonb,jsonb,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.pos_expedition_scan_batch(p_entries jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE entry jsonb; ids uuid[]; BEGIN
IF NOT public.is_team_member((SELECT auth.uid())) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Lote inválido'; END IF;
FOR entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
IF NOT EXISTS(SELECT 1 FROM public.pos_sales s JOIN public.pos_sale_items i ON i.sale_id=s.id WHERE s.id=(entry->>'sale_id')::uuid AND i.id=(entry->>'sale_item_id')::uuid) THEN RAISE EXCEPTION 'Item não pertence ao pedido'; END IF;
INSERT INTO public.expedition_scan_log(id,flow,stage,method,code_read,variant_code,variant_id,sale_id,sale_item_id,product_name,variant_name,sku,barcode,quantity,store_id) SELECT (entry->>'id')::uuid,'pos','conferencia',entry->>'method',left(entry->>'code_read',255),left(entry->>'variant_code',255),(entry->>'variant_id')::uuid,s.id,i.id,i.product_name,i.variant_name,i.sku,i.barcode,1,s.store_id FROM public.pos_sales s JOIN public.pos_sale_items i ON i.sale_id=s.id WHERE s.id=(entry->>'sale_id')::uuid AND i.id=(entry->>'sale_item_id')::uuid ON CONFLICT(id) DO NOTHING;
END LOOP;
SELECT array_agg((e->>'id')::uuid) INTO ids FROM jsonb_array_elements(p_entries) e;
RETURN coalesce((SELECT jsonb_agg(id) FROM public.expedition_scan_log WHERE id=ANY(ids) AND operator_id=(SELECT auth.uid())),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.pos_expedition_scan_batch(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pos_expedition_scan_batch(jsonb) TO authenticated;