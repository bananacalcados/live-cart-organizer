-- Multi-store events + manual POS routing
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS store_ids uuid[] NULL,
  ADD COLUMN IF NOT EXISTS manual_pos_routing boolean NOT NULL DEFAULT false;

-- Skip auto-route when the event uses manual multi-store routing
CREATE OR REPLACE FUNCTION public.trg_route_paid_event_order_to_pos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event_channel TEXT;
  v_default_store UUID;
  v_manual BOOLEAN;
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
      NULL;
    ELSIF v_was_paid THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT channel, default_store_id, manual_pos_routing
    INTO v_event_channel, v_default_store, v_manual
  FROM public.events WHERE id = NEW.event_id;

  -- Manual multi-store events do NOT auto-route: user picks store + seller in the card.
  IF COALESCE(v_manual, FALSE) THEN
    RETURN NEW;
  END IF;

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