-- Pre-change definitions used only in the disposable database regression.
CREATE OR REPLACE FUNCTION public.check_exchange_eligibility(p_order_ref text, p_request_type text, p_customer_reported_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.support_auto_detect_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF NEW.channel='instagram' AND coalesce(NEW.message,'') LIKE '💬 Comentário%' THEN RETURN NULL; END IF;
    IF coalesce(NEW.media_type,'') !~* '^(sticker|reaction|reacao|figurinha)$' THEN
      PERFORM public.support_ai_enqueue(NEW.id,NEW.phone,NEW.whatsapp_number_id,NEW.channel,NEW.message);
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'support_auto_detect: %',SQLERRM;
  END;
  RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION public.central_ship_guarantee(p_sale uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.shipped_at + interval '7 days' FROM public.pos_sales s
  WHERE s.id = p_sale AND s.shipped_at IS NOT NULL AND s.shipped_at <= now() AND now() <= s.shipped_at + interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.shipment_simulations x WHERE x.sale_id = s.id AND x.merged_into_id IS NULL AND x.delivered_at IS NOT NULL AND x.delivered_source = 'carrier')
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_shipment_tracking_for_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fulfillment TEXT;
  v_master public.shipment_simulations%ROWTYPE;
  v_phone TEXT;
BEGIN
  IF NEW.status NOT IN ('paid', 'completed') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status_cancelamento::text, 'ativo') <> 'ativo' THEN
    RETURN NEW;
  END IF;
  -- somente vendas online
  IF COALESCE(NEW.sales_channel, 'presencial') NOT IN ('site', 'live', 'link_online', 'whatsapp') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_simulations WHERE sale_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_fulfillment := CASE WHEN COALESCE(NEW.is_store_pickup, false) THEN 'pickup' ELSE 'carrier' END;
  v_phone := regexp_replace(COALESCE(NEW.customer_phone, ''), '\D', '', 'g');

  -- reaproveita o envio em aberto do mesmo cliente (envio unificado)
  IF length(v_phone) >= 8 THEN
    SELECT * INTO v_master
      FROM public.shipment_simulations s
     WHERE s.kind = 'order'
       AND s.merged_into_id IS NULL
       AND s.real_tracking_code IS NULL
       AND s.delivered_at IS NULL
       AND COALESCE(s.fulfillment, 'carrier') = v_fulfillment
       AND s.created_at > now() - interval '7 days'
       AND right(regexp_replace(COALESCE(s.customer_phone, ''), '\D', '', 'g'), 8) = right(v_phone, 8)
     ORDER BY s.created_at DESC
     LIMIT 1;
  END IF;

  INSERT INTO public.shipment_simulations (
    tracking_code, sale_id, kind, fulfillment, stage, stage_started_at,
    customer_name, customer_phone, order_reference,
    destination_city, destination_state, posted_at, status, merged_into_id
  ) VALUES (
    public.gen_shipment_public_code(), NEW.id, 'order', v_fulfillment, 'em_separacao', now(),
    NEW.customer_name, NEW.customer_phone, upper(substr(NEW.id::text, 1, 8)),
    NEW.customer_city, NEW.customer_state, now(), 'active', v_master.id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$
;