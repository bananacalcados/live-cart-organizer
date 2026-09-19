
CREATE OR REPLACE FUNCTION public.live_backfill_order_phone(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_phone text;
  v_count int;
  v_existing text;
BEGIN
  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL OR v_order.phone_last4 IS NULL OR v_order.event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT c.whatsapp INTO v_existing FROM public.customers c WHERE c.id = v_order.customer_id;
  IF coalesce(v_existing, '') <> '' THEN
    RETURN jsonb_build_object('ok', false, 'already', true);
  END IF;

  -- Só considera cliques VERIFICADOS: a pessoa realmente enviou mensagem (k.phone preenchido).
  SELECT count(DISTINCT regexp_replace(k.phone, '\D', '', 'g'))
    INTO v_count
    FROM public.live_whatsapp_clicks k
   WHERE k.event_id = v_order.event_id
     AND k.phone IS NOT NULL
     AND k.created_at >= date_trunc('day', now())
     AND right(regexp_replace(k.phone, '\D', '', 'g'), 4) = v_order.phone_last4;

  IF v_count <> 1 THEN
    IF v_count > 1 THEN
      UPDATE public.orders SET link_status = 'manual_required' WHERE id = v_order.id AND link_status <> 'linked';
    END IF;
    RETURN jsonb_build_object('ok', false, 'ambiguous', v_count > 1);
  END IF;

  SELECT DISTINCT regexp_replace(k.phone, '\D', '', 'g') INTO v_phone
    FROM public.live_whatsapp_clicks k
   WHERE k.event_id = v_order.event_id
     AND k.phone IS NOT NULL
     AND k.created_at >= date_trunc('day', now())
     AND right(regexp_replace(k.phone, '\D', '', 'g'), 4) = v_order.phone_last4
   LIMIT 1;

  UPDATE public.customers SET whatsapp = v_phone, updated_at = now() WHERE id = v_order.customer_id;
  UPDATE public.orders SET link_status = 'linked', updated_at = now() WHERE id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'phone', v_phone);
END;
$function$;

CREATE OR REPLACE FUNCTION public.live_link_order_by_last4(p_event_id uuid, p_phone_e164 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone_e164,''), '\D', '', 'g');
  v_last4 text;
  v_count int;
  v_order public.orders%ROWTYPE;
  v_handle text;
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

  -- NÃO grava o telefone aqui: neste momento ele foi apenas DIGITADO, sem verificação.
  -- O número só é gravado quando a mensagem dela chega (live_zap_after_match / backfill verificado).
  SELECT c.instagram_handle INTO v_handle FROM public.customers c WHERE c.id = v_order.customer_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'instagram_handle', v_handle, 'linked', false);
END;
$function$;

-- Limpa o número inexistente anexado por engano ao pedido da shil magalhaes
UPDATE public.customers SET whatsapp = NULL, updated_at = now()
 WHERE id = '64acc69a-71d2-4ed4-ba30-787a6e07d8df' AND whatsapp = '5573998264426';
