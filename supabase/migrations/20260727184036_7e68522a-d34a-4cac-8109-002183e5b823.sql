CREATE OR REPLACE FUNCTION public.sync_order_payment_to_pos_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_stages TEXT[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
  v_is_now_paid BOOLEAN;
BEGIN
  IF NEW.pos_sale_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_now_paid := COALESCE(NEW.is_paid, FALSE)
                   OR COALESCE(NEW.paid_externally, FALSE)
                   OR (NEW.stage = ANY(v_paid_stages));

  IF NOT v_is_now_paid THEN
    RETURN NEW;
  END IF;

  UPDATE public.pos_sales s
     SET status = 'paid',
         paid_at = COALESCE(s.paid_at, NEW.paid_at, now()),
         payment_method = COALESCE(s.payment_method, NEW.payment_method_label),
         payment_details = COALESCE(s.payment_details, '{}'::jsonb)
           || jsonb_build_object(
                'payment_method', COALESCE(s.payment_method, NEW.payment_method_label),
                'installments', COALESCE(NEW.installments, 1),
                'payment_confirmed_source', NEW.payment_confirmed_source
              ),
         updated_at = now()
   WHERE s.id = NEW.pos_sale_id
     AND COALESCE(s.status, '') NOT IN ('paid','completed','cancelled','refunded');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_order_payment_to_pos_sale failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_payment_to_pos_sale ON public.orders;
CREATE TRIGGER trg_sync_order_payment_to_pos_sale
AFTER UPDATE OF is_paid, paid_externally, stage, payment_method_label ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_payment_to_pos_sale();