
CREATE OR REPLACE FUNCTION public.expire_live_payment_windows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  UPDATE public.orders
     SET stage = 'awaiting_confirmation',
         payment_window_expires_at = NULL,
         customer_confirmed_at = NULL
   WHERE stage IN ('new', 'awaiting_payment')
     AND COALESCE(is_paid, false) = false
     AND payment_window_expires_at IS NOT NULL
     AND payment_window_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
