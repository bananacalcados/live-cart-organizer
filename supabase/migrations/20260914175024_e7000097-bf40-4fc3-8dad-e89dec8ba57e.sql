ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS phone_last4 text,
  ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'auto';

CREATE INDEX IF NOT EXISTS idx_orders_event_last4
  ON public.orders (event_id, phone_last4)
  WHERE phone_last4 IS NOT NULL AND stage <> 'cancelled';

-- Marca empate de final dentro do mesmo evento
CREATE OR REPLACE FUNCTION public.live_mark_last4_conflicts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF NEW.phone_last4 IS NULL OR NEW.event_id IS NULL OR NEW.stage = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.orders o
   WHERE o.event_id = NEW.event_id
     AND o.phone_last4 = NEW.phone_last4
     AND o.stage <> 'cancelled';

  IF v_count > 1 THEN
    UPDATE public.orders o
       SET link_status = 'manual_required'
     WHERE o.event_id = NEW.event_id
       AND o.phone_last4 = NEW.phone_last4
       AND o.stage <> 'cancelled'
       AND o.link_status <> 'linked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_mark_last4_conflicts ON public.orders;
CREATE TRIGGER trg_live_mark_last4_conflicts
AFTER INSERT OR UPDATE OF phone_last4 ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.live_mark_last4_conflicts();

-- Vinculação a partir do telefone digitado no link da Live
CREATE OR REPLACE FUNCTION public.live_link_order_by_last4(p_event_id uuid, p_phone_e164 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.customers c
     SET whatsapp = CASE WHEN coalesce(c.whatsapp,'') = '' THEN v_digits ELSE c.whatsapp END,
         updated_at = now()
   WHERE c.id = v_order.customer_id
  RETURNING c.instagram_handle INTO v_handle;

  UPDATE public.orders o
     SET link_status = 'linked', updated_at = now()
   WHERE o.id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'instagram_handle', v_handle);
END;
$$;

REVOKE ALL ON FUNCTION public.live_link_order_by_last4(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.live_link_order_by_last4(uuid, text) TO service_role;

-- Vinculação retroativa: cliques do mesmo evento no mesmo dia
CREATE OR REPLACE FUNCTION public.live_backfill_order_phone(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT count(DISTINCT regexp_replace(k.entered_phone, '\D', '', 'g'))
    INTO v_count
    FROM public.live_whatsapp_clicks k
   WHERE k.event_id = v_order.event_id
     AND k.entered_phone IS NOT NULL
     AND k.created_at >= date_trunc('day', now())
     AND right(regexp_replace(k.entered_phone, '\D', '', 'g'), 4) = v_order.phone_last4;

  IF v_count <> 1 THEN
    IF v_count > 1 THEN
      UPDATE public.orders SET link_status = 'manual_required' WHERE id = v_order.id AND link_status <> 'linked';
    END IF;
    RETURN jsonb_build_object('ok', false, 'ambiguous', v_count > 1);
  END IF;

  SELECT DISTINCT regexp_replace(k.entered_phone, '\D', '', 'g') INTO v_phone
    FROM public.live_whatsapp_clicks k
   WHERE k.event_id = v_order.event_id
     AND k.entered_phone IS NOT NULL
     AND k.created_at >= date_trunc('day', now())
     AND right(regexp_replace(k.entered_phone, '\D', '', 'g'), 4) = v_order.phone_last4
   LIMIT 1;

  UPDATE public.customers SET whatsapp = v_phone, updated_at = now() WHERE id = v_order.customer_id;
  UPDATE public.orders SET link_status = 'linked', updated_at = now() WHERE id = v_order.id;

  RETURN jsonb_build_object('ok', true, 'phone', v_phone);
END;
$$;

GRANT EXECUTE ON FUNCTION public.live_backfill_order_phone(uuid) TO authenticated, service_role;