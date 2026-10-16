CREATE OR REPLACE FUNCTION public.orders_payment_source_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  paid_stages text[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
  becomes_paid boolean;
  sandbox_correction boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    sandbox_correction := session_user = 'postgres'
      AND NEW.is_paid = false AND COALESCE(NEW.paid_externally,false) = false
      AND NEW.stage = 'awaiting_payment'
      AND EXISTS (SELECT 1 FROM public.pos_checkout_attempts a WHERE a.sale_id = OLD.id::text AND a.gateway='austpay' AND a.status='invalidated' AND a.metadata->>'invalidated_reason'='sandbox_not_real_payment')
      AND NOT EXISTS (SELECT 1 FROM public.pos_checkout_attempts a WHERE a.sale_id=OLD.id::text AND a.status='success');
    IF OLD.payment_confirmed_source = 'gateway_webhook' AND NOT sandbox_correction THEN
      IF (COALESCE(OLD.is_paid,false) AND NOT COALESCE(NEW.is_paid,false))
        OR (COALESCE(OLD.paid_externally,false) AND NOT COALESCE(NEW.paid_externally,false))
        OR NEW.payment_confirmed_source IS DISTINCT FROM 'gateway_webhook' THEN
        RAISE EXCEPTION 'Pagamento confirmado pelo gateway não pode ser revertido ou reclassificado (order %).', OLD.id USING ERRCODE='check_violation';
      END IF;
    END IF;
  END IF;
  becomes_paid := COALESCE(NEW.is_paid,false) OR COALESCE(NEW.paid_externally,false) OR NEW.stage=ANY(paid_stages);
  IF becomes_paid AND NEW.payment_confirmed_source IS NULL THEN NEW.payment_confirmed_source := 'manual'; END IF;
  IF NOT becomes_paid THEN NEW.payment_confirmed_source := NULL; NEW.paid_at := NULL; END IF;
  RETURN NEW;
END;
$function$;