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
BEGIN
  v_is_now_paid := COALESCE(NEW.is_paid, FALSE)
                   OR COALESCE(NEW.paid_externally, FALSE)
                   OR (NEW.stage = ANY(v_paid_stages));

  IF NOT v_is_now_paid THEN
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
    IF v_was_paid AND OLD.pos_sale_id IS NULL THEN
      -- Was already paid before; if not yet routed, allow re-attempt (idempotent function checks pos_sale_id)
      NULL;
    ELSIF v_was_paid THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT channel, default_store_id INTO v_event_channel, v_default_store
  FROM public.events WHERE id = NEW.event_id;

  IF v_default_store IS NULL OR v_event_channel = 'site' OR v_event_channel IS NULL THEN
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

DROP TRIGGER IF EXISTS trg_route_event_order_pos ON public.orders;
CREATE TRIGGER trg_route_event_order_pos
AFTER INSERT OR UPDATE OF is_paid, paid_externally, stage ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_route_paid_event_order_to_pos();