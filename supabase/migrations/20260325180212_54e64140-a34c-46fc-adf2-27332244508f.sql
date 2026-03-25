CREATE OR REPLACE FUNCTION public.check_order_paid(p_order_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_paid boolean;
  v_stage text;
BEGIN
  SELECT is_paid, stage 
  INTO v_is_paid, v_stage
  FROM orders 
  WHERE id::text = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN (v_is_paid = true OR v_stage IN ('paid', 'concluido', 'pago', 'completed'));
END;
$$;