ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS max_installments_override smallint;

-- Validation trigger: must be between 2 and 12 if set
CREATE OR REPLACE FUNCTION public.validate_max_installments_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.max_installments_override IS NOT NULL 
     AND (NEW.max_installments_override < 2 OR NEW.max_installments_override > 12) THEN
    RAISE EXCEPTION 'max_installments_override must be between 2 and 12';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_max_installments_override_trigger ON public.orders;
CREATE TRIGGER validate_max_installments_override_trigger
BEFORE INSERT OR UPDATE OF max_installments_override ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_max_installments_override();

COMMENT ON COLUMN public.orders.max_installments_override IS 'Override per-order do limite máximo de parcelas no checkout (2-12). Quando NULL, usa o padrão de app_settings.installment_config.';