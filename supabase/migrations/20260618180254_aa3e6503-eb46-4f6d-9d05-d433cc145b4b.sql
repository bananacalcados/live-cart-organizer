-- Standardize the sale->customer link on the canonical find-or-create function
CREATE OR REPLACE FUNCTION public.trg_pos_sales_sync_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.customer_unified_id IS NOT NULL THEN
      PERFORM public.recalc_customer_metrics(OLD.customer_unified_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.customer_unified_id IS NULL
     AND (NEW.customer_phone IS NOT NULL OR NEW.customer_cpf IS NOT NULL OR NEW.customer_email IS NOT NULL) THEN
    v_uid := public.find_or_create_unified_customer(
      p_cpf    => NEW.customer_cpf,
      p_phone  => NEW.customer_phone,
      p_email  => NEW.customer_email,
      p_name   => NEW.customer_name,
      p_source => 'pos-sale'
    );
    IF v_uid IS NOT NULL THEN
      NEW.customer_unified_id := v_uid;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Remove the duplicate dedup function created in the previous step
DROP FUNCTION IF EXISTS public.find_or_create_customer_unified(text,text,text,text,text,text,text,text,text,text,text);