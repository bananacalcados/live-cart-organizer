-- 1. Column
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_confirmed_source text;

CREATE INDEX IF NOT EXISTS orders_payment_confirmed_source_idx
  ON public.orders (payment_confirmed_source)
  WHERE payment_confirmed_source IS NOT NULL;

-- 2. Guard + default trigger
CREATE OR REPLACE FUNCTION public.orders_payment_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paid_stages text[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
  becomes_paid boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.payment_confirmed_source = 'gateway_webhook' THEN
      IF (COALESCE(OLD.is_paid,false) = true AND COALESCE(NEW.is_paid,false) = false)
         OR (COALESCE(OLD.paid_externally,false) = true AND COALESCE(NEW.paid_externally,false) = false)
         OR (NEW.payment_confirmed_source IS DISTINCT FROM 'gateway_webhook') THEN
        RAISE EXCEPTION 'Pagamento confirmado pelo gateway não pode ser revertido ou reclassificado (order %).', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  becomes_paid := COALESCE(NEW.is_paid,false) = true
               OR COALESCE(NEW.paid_externally,false) = true
               OR NEW.stage = ANY(paid_stages);

  IF becomes_paid AND NEW.payment_confirmed_source IS NULL THEN
    NEW.payment_confirmed_source := 'manual';
  END IF;

  -- Cleared: no longer paid at all → drop source so it can be re-marked later
  IF NOT becomes_paid
     AND COALESCE(NEW.is_paid,false) = false
     AND COALESCE(NEW.paid_externally,false) = false THEN
    NEW.payment_confirmed_source := NULL;
    NEW.paid_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_payment_source_guard ON public.orders;
CREATE TRIGGER trg_orders_payment_source_guard
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_payment_source_guard();

-- 3. Backfill
UPDATE public.orders
SET payment_confirmed_source = 'gateway_webhook'
WHERE payment_confirmed_source IS NULL
  AND (is_paid = true OR paid_externally = true)
  AND (
       mercadopago_payment_id IS NOT NULL
    OR appmax_order_id IS NOT NULL
    OR pagarme_order_id IS NOT NULL
    OR vindi_transaction_id IS NOT NULL
    OR shopify_order_id IS NOT NULL
    OR shopify_order_name IS NOT NULL
  );

UPDATE public.orders
SET payment_confirmed_source = 'manual'
WHERE payment_confirmed_source IS NULL
  AND (is_paid = true OR paid_externally = true);