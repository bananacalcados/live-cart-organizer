DO $patch$
DECLARE f record; d text; original text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN ('check_exchange_eligibility','central_submit_atomic','central_context','central_reverse_prepare','central_ship_guarantee','ensure_shipment_tracking_for_sale','support_auto_detect_trigger') LOOP
  d:=pg_get_functiondef(f.oid); original:=d;
  IF f.proname='check_exchange_eligibility' THEN
   d:=replace(d,'v_reported_ok boolean;','v_reported_ok boolean; v_pickup jsonb;');
   d:=replace(d,'  IF v_sim.delivered_at IS NOT NULL AND v_sim.delivered_source = ''carrier'' THEN',E'  SELECT public.pickup_delivery_guard(p) INTO v_pickup FROM public.pos_sales p WHERE p.id=v_sale;\n  IF coalesce((v_pickup->>''pickup'')::boolean,false) AND NOT coalesce((v_pickup->>''allowed'')::boolean,false) AND NOT (v_sim.delivered_at IS NOT NULL AND v_sim.delivered_source=''carrier'') THEN\n    RETURN jsonb_build_object(''eligible'',''needs_human'',''reason'',''retirada_nao_confirmada:''||(v_pickup->>''reason''),''delivered_at'',NULL,''delivered_source'',NULL,''deadline_at'',NULL,''window_days'',v_days,''sale_id'',v_sale);\n  END IF;\n  IF v_sim.delivered_at IS NOT NULL AND v_sim.delivered_source IN (''carrier'',''retirada'') THEN');
   d:=replace(d,'''delivered_source'', ''carrier'', ''deadline_at''','''delivered_source'', v_sim.delivered_source, ''deadline_at''');
  ELSIF f.proname='ensure_shipment_tracking_for_sale' THEN
   d:=replace(d,E'BEGIN\n',E'BEGIN\n  IF TG_OP=''UPDATE'' AND OLD.is_store_pickup IS TRUE THEN\n    PERFORM public.sync_pickup_delivery(NEW.id);\n  ELSIF NEW.is_store_pickup IS TRUE OR coalesce(NEW.tracking_carrier,'''') ~* ''(retir|pickup)'' OR coalesce(NEW.shipping_carrier,'''') ~* ''(retir|pickup)'' OR (TG_OP=''UPDATE'' AND (coalesce(OLD.tracking_carrier,'''') ~* ''(retir|pickup)'' OR coalesce(OLD.shipping_carrier,'''') ~* ''(retir|pickup)'')) THEN\n    PERFORM public.sync_pickup_delivery(NEW.id);\n  END IF;\n');
  ELSIF f.proname='support_auto_detect_trigger' THEN
   d:=replace(d,E'BEGIN\n',E'BEGIN\n  BEGIN\n    IF NEW.direction=''incoming'' AND NEW.is_group IS NOT TRUE AND NEW.source IS DISTINCT FROM ''instagram_backfill'' AND public.pickup_shipping_question(NEW.message) THEN\n      PERFORM public.invalidate_pickup_on_shipping_question(NEW.phone,NEW.created_at);\n    END IF;\n  EXCEPTION WHEN others THEN RAISE WARNING ''pickup_invalidation: %'',SQLERRM; END;\n');
  ELSE
   d:=replace(d,'delivered_source=''carrier''','delivered_source IN (''carrier'',''retirada'')');
   d:=replace(d,'delivered_source = ''carrier''','delivered_source IN (''carrier'',''retirada'')');
   d:=replace(d,'CASE WHEN trusted IS TRUE THEN ''carrier''','CASE WHEN trusted IS TRUE THEN e->>''delivered_source''');
   d:=replace(d,'CASE WHEN trusted THEN ''carrier''','CASE WHEN trusted THEN e->>''delivered_source''');
   IF f.proname='central_ship_guarantee' THEN
    d:=replace(d,'WHERE s.id = p_sale AND',E'WHERE s.id = p_sale AND (NOT coalesce((public.pickup_delivery_guard(s)->>''pickup'')::boolean,false) OR coalesce((public.pickup_delivery_guard(s)->>''allowed'')::boolean,false)) AND');
   END IF;
  END IF;
  -- Legacy overloads forwarding to the current function have no evidence decisions.
  IF d=original AND f.proname='central_submit_atomic' THEN CONTINUE; END IF;
  IF d=original THEN RAISE EXCEPTION 'No pickup patch matched %',f.proname; END IF;
  EXECUTE d;
 END LOOP;
END $patch$;
DROP TRIGGER trg_ensure_shipment_tracking ON public.pos_sales;
CREATE TRIGGER trg_ensure_shipment_tracking AFTER INSERT ON public.pos_sales FOR EACH ROW EXECUTE FUNCTION public.ensure_shipment_tracking_for_sale();
CREATE TRIGGER trg_ensure_shipment_tracking_update AFTER UPDATE OF status,expedition_finished_at,expedition_stage,shipped_at,shipped_source,tracking_carrier,shipping_carrier,is_store_pickup,customer_state,customer_city,customer_cep,shipping_address,payment_details,discount,voucher_amount,sale_type,status_cancelamento ON public.pos_sales FOR EACH ROW WHEN (ROW(OLD.status,OLD.expedition_finished_at,OLD.expedition_stage,OLD.shipped_at,OLD.shipped_source,OLD.tracking_carrier,OLD.shipping_carrier,OLD.is_store_pickup,OLD.customer_state,OLD.customer_city,OLD.customer_cep,OLD.shipping_address,OLD.payment_details,OLD.discount,OLD.voucher_amount,OLD.sale_type,OLD.status_cancelamento) IS DISTINCT FROM ROW(NEW.status,NEW.expedition_finished_at,NEW.expedition_stage,NEW.shipped_at,NEW.shipped_source,NEW.tracking_carrier,NEW.shipping_carrier,NEW.is_store_pickup,NEW.customer_state,NEW.customer_city,NEW.customer_cep,NEW.shipping_address,NEW.payment_details,NEW.discount,NEW.voucher_amount,NEW.sale_type,NEW.status_cancelamento)) EXECUTE FUNCTION public.ensure_shipment_tracking_for_sale();