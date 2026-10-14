CREATE OR REPLACE FUNCTION public.lp_leads_mark_existing_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text;
BEGIN
  IF NEW.dispatch_excluded_reason IS NOT NULL OR NEW.phone IS NULL THEN RETURN NEW; END IF;
  k := right(regexp_replace(NEW.phone, '\D', '', 'g'), 8);
  IF length(k) = 8 AND EXISTS (
    SELECT 1 FROM public.customers_unified c
    WHERE c.phone_suffix8 = k AND coalesce(c.total_orders, 0) > 0
  ) THEN
    NEW.dispatch_excluded_reason := 'ja_cliente';
    NEW.dispatch_excluded_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lp_leads_mark_existing_customer ON public.lp_leads;
CREATE TRIGGER trg_lp_leads_mark_existing_customer
BEFORE INSERT ON public.lp_leads
FOR EACH ROW EXECUTE FUNCTION public.lp_leads_mark_existing_customer();