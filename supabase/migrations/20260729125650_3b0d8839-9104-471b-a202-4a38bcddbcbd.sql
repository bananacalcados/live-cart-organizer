CREATE OR REPLACE FUNCTION public.trg_route_paid_event_order_to_pos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event_channel TEXT;
  v_default_store UUID;
  v_paid_stages TEXT[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
  v_is_now_paid BOOLEAN;
  v_was_paid BOOLEAN;
  v_released BOOLEAN;
  v_was_released BOOLEAN;
BEGIN
  v_is_now_paid := COALESCE(NEW.is_paid, FALSE)
                   OR COALESCE(NEW.paid_externally, FALSE)
                   OR (NEW.stage = ANY(v_paid_stages));
  v_released := COALESCE(NEW.release_to_expedition, FALSE);

  IF NOT v_is_now_paid AND NOT v_released THEN
    RETURN NEW;
  END IF;

  IF NEW.pos_sale_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_was_paid := COALESCE(OLD.is_paid, FALSE)
                  OR COALESCE(OLD.paid_externally, FALSE)
                  OR (OLD.stage = ANY(v_paid_stages));
    v_was_released := COALESCE(OLD.release_to_expedition, FALSE);
    IF (v_was_paid OR v_was_released) AND OLD.pos_sale_id IS NULL THEN
      NULL;
    ELSIF v_was_paid OR v_was_released THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT channel, default_store_id INTO v_event_channel, v_default_store
  FROM public.events WHERE id = NEW.event_id;

  -- Eventos do canal "site" (Live/Site) NÃO têm default_store_id: a edge function
  -- resolve para a loja Site/Live. Só ignoramos quando não há canal nem loja.
  IF v_default_store IS NULL AND COALESCE(v_event_channel, '') <> 'site' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/event-order-route-to-pos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('order_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'route_paid_event_order_to_pos failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Reprocessa pedidos pagos de eventos que ficaram sem venda no PDV (últimos 7 dias)
UPDATE public.orders
   SET updated_at = now()
 WHERE event_id IS NOT NULL
   AND pos_sale_id IS NULL
   AND is_paid = true
   AND stage <> 'cancelled'
   AND paid_at > now() - interval '7 days';