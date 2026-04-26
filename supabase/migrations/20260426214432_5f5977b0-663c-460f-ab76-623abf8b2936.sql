-- Add column to track when Purchase CAPI event was sent (prevents duplicates)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS meta_capi_purchase_sent_at timestamptz;

-- Trigger function: when an order moves to stage='paid', invoke meta-capi-event for Purchase
CREATE OR REPLACE FUNCTION public.trigger_meta_capi_purchase_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_should_send boolean := false;
  v_supabase_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co';
  v_total numeric := 0;
  v_request_id bigint;
  v_event_id text;
BEGIN
  -- Only fire when:
  --  • stage transitions INTO 'paid' (UPDATE), OR row inserted directly as 'paid'
  --  • event_id is set (Live/Eventos order)
  --  • Purchase has not been sent before
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.meta_capi_purchase_sent_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.stage IS DISTINCT FROM 'paid' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_send := true;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.stage, '') IS DISTINCT FROM 'paid' THEN
    v_should_send := true;
  END IF;

  IF NOT v_should_send THEN RETURN NEW; END IF;

  -- Compute total from products jsonb (subtotal − discount + shipping)
  SELECT COALESCE(SUM((item->>'price')::numeric * (item->>'quantity')::numeric), 0)
    INTO v_total
  FROM jsonb_array_elements(COALESCE(NEW.products, '[]'::jsonb)) AS item;

  -- Apply discount
  IF NEW.discount_type = 'fixed' THEN
    v_total := v_total - COALESCE(NEW.discount_value, 0);
  ELSIF NEW.discount_type = 'percentage' THEN
    v_total := v_total - ROUND(v_total * COALESCE(NEW.discount_value, 0) / 100, 2);
  END IF;

  -- Add shipping if not free
  IF NOT COALESCE(NEW.free_shipping, false) THEN
    v_total := v_total + COALESCE(NEW.shipping_cost, 0);
  END IF;

  IF v_total <= 0 THEN RETURN NEW; END IF;

  v_event_id := 'purchase_order_' || NEW.id::text;

  -- Fire async via pg_net
  SELECT extensions.net.http_post(
    url := v_supabase_url || '/functions/v1/meta-capi-event',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'event_name', 'Purchase',
      'event_id',   v_event_id,
      'order_id',   NEW.id::text,
      'value',      v_total,
      'currency',   'BRL',
      'action_source', 'website'
    )
  ) INTO v_request_id;

  -- Mark as sent immediately to prevent duplicate firings
  NEW.meta_capi_purchase_sent_at := now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trigger_meta_capi_purchase_on_paid] error for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meta_capi_purchase_on_paid ON public.orders;
CREATE TRIGGER trg_meta_capi_purchase_on_paid
BEFORE INSERT OR UPDATE OF stage ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trigger_meta_capi_purchase_on_paid();