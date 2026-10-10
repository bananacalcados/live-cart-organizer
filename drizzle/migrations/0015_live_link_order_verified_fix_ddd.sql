CREATE OR REPLACE FUNCTION public.live_link_order_verified(p_event_id uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_last4 text;
  v_count int;
  v_order public.orders%ROWTYPE;
  v_existing text;
  v_existing_digits text;
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
  v_existing_digits := regexp_replace(coalesce(v_existing,''), '\D', '', 'g');

  IF v_existing_digits <> '' THEN
    IF v_existing_digits = v_digits THEN
      UPDATE public.orders SET link_status = 'linked', updated_at = now()
       WHERE id = v_order.id AND link_status <> 'linked';
      RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'already', true);
    END IF;
    -- Mesmo número com DDD errado (digitado errado no link): o telefone
    -- verificado pela mensagem real corrige o cadastro.
    IF right(v_existing_digits, 8) = right(v_digits, 8) THEN
      UPDATE public.customers SET whatsapp = v_digits, updated_at = now() WHERE id = v_order.customer_id;
      UPDATE public.orders SET link_status = 'linked', updated_at = now() WHERE id = v_order.id;
      RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'phone', v_digits, 'ddd_fixed', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'conflict', true);
  END IF;

  UPDATE public.customers SET whatsapp = v_digits, updated_at = now() WHERE id = v_order.customer_id;
  UPDATE public.orders SET link_status = 'linked', updated_at = now() WHERE id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'phone', v_digits);
END;
$function$;