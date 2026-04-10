
CREATE OR REPLACE FUNCTION public.auto_convert_leads_on_customer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_suffix text;
BEGIN
  -- Extract the 8-digit suffix from the new customer's phone
  v_suffix := right(regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g'), 8);
  
  IF length(v_suffix) >= 8 THEN
    UPDATE lp_leads
    SET converted = true, converted_at = COALESCE(converted_at, now())
    WHERE converted = false
      AND phone IS NOT NULL
      AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 8) = v_suffix;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_convert_leads_on_zoppy_customer ON public.zoppy_customers;
CREATE TRIGGER trg_auto_convert_leads_on_zoppy_customer
  AFTER INSERT ON public.zoppy_customers
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_convert_leads_on_customer_sync();
