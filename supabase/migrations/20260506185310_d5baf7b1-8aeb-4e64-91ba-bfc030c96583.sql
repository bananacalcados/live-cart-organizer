CREATE OR REPLACE FUNCTION public.trg_route_paid_event_order_to_pos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event_channel TEXT;
  v_default_store UUID;
BEGIN
  -- only when order becomes paid for the first time and isn't yet routed
  IF NEW.is_paid IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.pos_sale_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_paid IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT channel, default_store_id INTO v_event_channel, v_default_store
  FROM public.events WHERE id = NEW.event_id;

  IF v_default_store IS NULL OR v_event_channel = 'site' OR v_event_channel IS NULL THEN
    RETURN NEW;
  END IF;

  -- Async fire-and-forget call to edge function
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

DROP TRIGGER IF EXISTS trg_route_event_order_pos ON public.orders;
CREATE TRIGGER trg_route_event_order_pos
AFTER INSERT OR UPDATE OF is_paid ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_route_paid_event_order_to_pos();