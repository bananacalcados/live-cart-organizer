CREATE OR REPLACE FUNCTION public.overlay_order_events()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_handle text; v_product text; v_size text;
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  SELECT ltrim(coalesce(instagram_handle,''),'@') INTO v_handle FROM customers WHERE id = NEW.customer_id;
  v_product := coalesce(NEW.products->0->>'title', NEW.products->0->>'name', 'seu par');
  v_size := coalesce(substring(coalesce(NEW.products->0->>'variant','') from '(\d{2})\s*$'), '');
  IF coalesce(NEW.is_paid,false) AND NOT coalesce(OLD.is_paid,false) THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'paid',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product', v_product, 'order_id', NEW.id));
  END IF;
  IF NEW.stage = 'awaiting_confirmation' AND OLD.stage IS DISTINCT FROM 'awaiting_confirmation' THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'assembled',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product', v_product, 'size', v_size,
        'expires_at', NEW.payment_window_expires_at, 'order_id', NEW.id));
  END IF;
  -- Relógio de pagamento: prazo começou agora (aditivo, kind novo)
  IF NEW.payment_window_expires_at IS NOT NULL AND OLD.payment_window_expires_at IS NULL
     AND NOT coalesce(NEW.is_paid,false) THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'timer',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product', v_product, 'size', v_size,
        'expires_at', NEW.payment_window_expires_at, 'order_id', NEW.id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER trg_overlay_order_events AFTER UPDATE OF is_paid, stage, payment_window_expires_at ON public.orders
FOR EACH ROW WHEN ((new.is_paid IS DISTINCT FROM old.is_paid) OR (new.stage IS DISTINCT FROM old.stage)
  OR (old.payment_window_expires_at IS NULL AND new.payment_window_expires_at IS NOT NULL))
EXECUTE FUNCTION overlay_order_events();

CREATE OR REPLACE FUNCTION public.expire_live_payment_windows()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
  ev record;
  v_secret text;
BEGIN
  -- Aviso "Liberou o par" no overlay (só lives no ar). Nunca bloqueia a expiração.
  BEGIN
    INSERT INTO public.live_overlay_events(event_id, kind, payload)
    SELECT o.event_id, 'expired', jsonb_build_object(
      'handle', ltrim(coalesce(c.instagram_handle,''),'@'),
      'product', coalesce(o.products->0->>'title', o.products->0->>'name', 'par'),
      'size', coalesce(substring(coalesce(o.products->0->>'variant','') from '(\d{2})\s*$'), ''),
      'order_id', o.id)
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id AND e.live_active_until > now()
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE COALESCE(o.is_paid, false) = false
       AND o.payment_window_expires_at IS NOT NULL
       AND o.payment_window_expires_at < now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'overlay expired events failed: %', SQLERRM;
  END;

  UPDATE public.orders
     SET payment_window_expires_at = NULL
   WHERE COALESCE(is_paid, false) = false
     AND payment_window_expires_at IS NOT NULL
     AND payment_window_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;

  BEGIN
    FOR ev IN
      SELECT id FROM public.events WHERE live_active_until > now() ORDER BY id LIMIT 3
    LOOP
      IF v_secret IS NULL THEN
        SELECT value INTO v_secret FROM public.internal_function_secrets WHERE key = 'cron_secret';
      END IF;
      PERFORM net.http_post(
        url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/instagram-live-sync',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
        body := jsonb_build_object('eventId', ev.id),
        timeout_milliseconds := 30000
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'instagram-live-sync dispatch failed: %', SQLERRM;
  END;

  RETURN affected;
END;
$function$;