CREATE OR REPLACE FUNCTION public.live_link_order_verified(p_event_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_last4 text;
  v_count int;
  v_order public.orders%ROWTYPE;
  v_existing text;
BEGIN
  IF p_event_id IS NULL OR length(v_digits) < 8 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  v_last4 := right(v_digits, 4);

  SELECT count(*) INTO v_count
    FROM public.orders o
   WHERE o.event_id = p_event_id
     AND o.phone_last4 = v_last4
     AND o.stage <> 'cancelled';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF v_count > 1 THEN
    UPDATE public.orders o
       SET link_status = 'manual_required'
     WHERE o.event_id = p_event_id
       AND o.phone_last4 = v_last4
       AND o.stage <> 'cancelled'
       AND o.link_status <> 'linked';
    RETURN jsonb_build_object('ok', false, 'ambiguous', true);
  END IF;

  SELECT o.* INTO v_order
    FROM public.orders o
   WHERE o.event_id = p_event_id
     AND o.phone_last4 = v_last4
     AND o.stage <> 'cancelled'
   LIMIT 1;

  SELECT c.whatsapp INTO v_existing FROM public.customers c WHERE c.id = v_order.customer_id;

  IF coalesce(v_existing,'') <> '' THEN
    IF right(regexp_replace(v_existing, '\D', '', 'g'), 8) = right(v_digits, 8) THEN
      UPDATE public.orders SET link_status = 'linked', updated_at = now()
       WHERE id = v_order.id AND link_status <> 'linked';
      RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'already', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'conflict', true);
  END IF;

  UPDATE public.customers SET whatsapp = v_digits, updated_at = now() WHERE id = v_order.customer_id;
  UPDATE public.orders SET link_status = 'linked', updated_at = now() WHERE id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'phone', v_digits);
END;
$function$;

CREATE OR REPLACE FUNCTION public.live_zap_after_match(p_click live_whatsapp_clicks, p_real_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_name text;
BEGIN
  IF p_click.fbc IS NOT NULL OR p_click.fbp IS NOT NULL OR p_click.fbclid IS NOT NULL THEN
    PERFORM public.upsert_meta_attribution(
      p_real_phone, p_click.fbc, p_click.fbp, NULL, p_click.fbclid,
      p_click.created_at, NULL, p_click.referer, 'live_whatsapp_link', p_click.lead_id);
    IF p_click.entered_phone IS NOT NULL
       AND public.live_zap_phone_key(p_click.entered_phone) IS DISTINCT FROM public.live_zap_phone_key(p_real_phone) THEN
      PERFORM public.upsert_meta_attribution(
        p_click.entered_phone, p_click.fbc, p_click.fbp, NULL, p_click.fbclid,
        p_click.created_at, NULL, p_click.referer, 'live_whatsapp_link', p_click.lead_id);
    END IF;
  END IF;

  IF p_click.entered_phone_key IS NOT NULL THEN
    UPDATE public.live_whatsapp_clicks
       SET superseded = true
     WHERE entered_phone_key = p_click.entered_phone_key
       AND phone IS NULL
       AND id <> p_click.id
       AND created_at <= p_click.created_at;
  END IF;

  IF p_click.lead_id IS NOT NULL THEN
    SELECT coalesce(nullif(trim(cc.custom_name), ''), nullif(trim(cc.display_name), ''))
      INTO v_name
      FROM public.chat_contacts cc
     WHERE public.live_zap_phone_key(cc.phone) = public.live_zap_phone_key(p_real_phone)
     ORDER BY (cc.custom_name IS NOT NULL) DESC, cc.updated_at DESC
     LIMIT 1;
    UPDATE public.event_leads
       SET name = coalesce(v_name, name),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('live_whatsapp_link_real_phone', p_real_phone, 'live_whatsapp_link_matched_at', now())
     WHERE id = p_click.lead_id
       AND (name = 'Lead WhatsApp' OR name IS NULL OR name = '');
  END IF;

  -- Vincula o pedido da Live pelos 4 últimos dígitos, agora com telefone VERIFICADO
  IF p_click.event_id IS NOT NULL THEN
    PERFORM public.live_link_order_verified(p_click.event_id, p_real_phone);
  END IF;
END;
$function$;