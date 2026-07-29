CREATE OR REPLACE FUNCTION public.sync_order_payment_to_pos_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paid_stages TEXT[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
  v_is_now_paid BOOLEAN;
BEGIN
  IF NEW.pos_sale_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_now_paid := COALESCE(NEW.is_paid, FALSE)
                   OR COALESCE(NEW.paid_externally, FALSE)
                   OR (NEW.stage = ANY(v_paid_stages));

  IF NOT v_is_now_paid THEN
    RETURN NEW;
  END IF;

  -- 1) Venda ainda não paga: marca como paga e grava a forma de pagamento
  UPDATE public.pos_sales s
     SET status = 'paid',
         paid_at = COALESCE(s.paid_at, NEW.paid_at, now()),
         payment_method = COALESCE(s.payment_method, NEW.payment_method_label),
         payment_details = COALESCE(s.payment_details, '{}'::jsonb)
           || jsonb_build_object(
                'payment_method', COALESCE(s.payment_method, NEW.payment_method_label),
                'installments', COALESCE(NEW.installments, 1),
                'payment_confirmed_source', NEW.payment_confirmed_source
              ),
         updated_at = now()
   WHERE s.id = NEW.pos_sale_id
     AND COALESCE(s.status, '') NOT IN ('paid','completed','cancelled','refunded');

  -- 2) Venda já paga porém SEM forma de pagamento: apenas completa o rótulo
  IF NEW.payment_method_label IS NOT NULL THEN
    UPDATE public.pos_sales s
       SET payment_method = NEW.payment_method_label,
           payment_details = COALESCE(s.payment_details, '{}'::jsonb)
             || jsonb_build_object(
                  'payment_method', NEW.payment_method_label,
                  'installments', COALESCE(NEW.installments, 1),
                  'payment_confirmed_source', NEW.payment_confirmed_source
                ),
           updated_at = now()
     WHERE s.id = NEW.pos_sale_id
       AND s.payment_method IS NULL
       AND COALESCE(s.status, '') NOT IN ('cancelled','refunded');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_order_payment_to_pos_sale failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;