CREATE OR REPLACE FUNCTION public.orders_paid_stage_autoconfirm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_paid_stages TEXT[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
BEGIN
  IF NEW.stage = ANY(v_paid_stages)
     AND NOT COALESCE(NEW.is_paid, false)
     AND NOT COALESCE(NEW.paid_externally, false) THEN
    NEW.is_paid := true;
    NEW.paid_at := COALESCE(NEW.paid_at, now());
    NEW.payment_confirmed_source := COALESCE(NEW.payment_confirmed_source, 'manual');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_paid_stage_autoconfirm ON public.orders;
CREATE TRIGGER trg_orders_paid_stage_autoconfirm
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_paid_stage_autoconfirm();