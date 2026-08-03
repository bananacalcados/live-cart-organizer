CREATE OR REPLACE FUNCTION public.expire_live_payment_windows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.orders
     SET payment_window_expires_at = NULL
   WHERE COALESCE(is_paid, false) = false
     AND payment_window_expires_at IS NOT NULL
     AND payment_window_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

UPDATE public.orders
   SET customer_confirmed_at = COALESCE(updated_at, created_at, now()),
       stage = CASE
         WHEN stage = 'awaiting_confirmation' THEN
           CASE
             WHEN EXISTS (
               SELECT 1
                 FROM public.customer_registrations cr
                WHERE cr.order_id = orders.id
                  AND NULLIF(BTRIM(cr.cpf), '') IS NOT NULL
                  AND NULLIF(BTRIM(cr.email), '') IS NOT NULL
                  AND NULLIF(BTRIM(cr.cep), '') IS NOT NULL
                  AND NULLIF(BTRIM(cr.address), '') IS NOT NULL
                  AND NULLIF(BTRIM(cr.address_number), '') IS NOT NULL
             ) THEN 'awaiting_payment'
             ELSE 'new'
           END
         ELSE stage
       END
 WHERE customer_confirmed_at IS NULL
   AND confirmed_items_signature IS NOT NULL;