CREATE INDEX IF NOT EXISTS idx_pos_sales_source_order_id ON public.pos_sales (source_order_id) WHERE source_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._norm_concrete_gateway(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN g IN ('mercadopago','mp') OR g LIKE 'mercado%' THEN 'mercadopago'
    WHEN g IN ('pagarme','pagar') THEN 'pagarme'
    WHEN g IN ('austpay','rinne') THEN 'austpay'
    WHEN g = 'appmax' THEN 'appmax'
    WHEN g = 'vindi' THEN 'vindi'
    ELSE NULL END
  FROM (SELECT regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]', '', 'g') AS g) x
$$;

-- Gateway que APROVOU o pedido: snapshot -> tentativa aprovada mais recente -> nota "Pago via" -> ID único.
-- IDs de gateways diferentes sem prova de aprovação = NULL (o fiscal cria pendência).
CREATE OR REPLACE FUNCTION public.order_approved_gateway(p_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; g text; ids text[];
BEGIN
  SELECT id, notes, gateway_snapshot, mercadopago_payment_id, pagarme_order_id, austpay_transaction_id, appmax_order_id, vindi_transaction_id
    INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  g := public._norm_concrete_gateway(o.gateway_snapshot->>'gateway');
  IF g IS NOT NULL THEN RETURN g; END IF;
  SELECT public._norm_concrete_gateway(a.gateway) INTO g FROM public.pos_checkout_attempts a
   WHERE a.sale_id = o.id AND a.status = 'success' AND public._norm_concrete_gateway(a.gateway) IS NOT NULL
   ORDER BY a.created_at DESC LIMIT 1;
  IF g IS NOT NULL THEN RETURN g; END IF;
  g := public._norm_concrete_gateway(substring(coalesce(o.notes,'') from '(?i)pago via (\w+)'));
  IF g IS NOT NULL THEN RETURN g; END IF;
  ids := array_remove(ARRAY[
    CASE WHEN o.mercadopago_payment_id IS NOT NULL THEN 'mercadopago' END,
    CASE WHEN o.austpay_transaction_id IS NOT NULL THEN 'austpay' END,
    CASE WHEN o.pagarme_order_id IS NOT NULL THEN 'pagarme' END,
    CASE WHEN o.appmax_order_id IS NOT NULL THEN 'appmax' END,
    CASE WHEN o.vindi_transaction_id IS NOT NULL THEN 'vindi' END], NULL);
  IF array_length(ids,1) = 1 THEN RETURN ids[1]; END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.order_approved_gateway(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_approved_gateway(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public._norm_concrete_gateway(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._norm_concrete_gateway(text) TO authenticated, service_role;

-- Copia gateway/IDs/snapshot do pedido para as vendas ligadas que ainda não têm gateway.
CREATE OR REPLACE FUNCTION public.apply_order_gateway_to_pos_sales(p_order_id uuid, p_pos_sale_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g text; o record; n integer;
BEGIN
  g := public.order_approved_gateway(p_order_id);
  IF g IS NULL THEN RETURN 0; END IF;
  SELECT gateway_snapshot, mercadopago_payment_id, pagarme_order_id, austpay_transaction_id, appmax_order_id, vindi_transaction_id
    INTO o FROM public.orders WHERE id = p_order_id;
  UPDATE public.pos_sales s SET
    payment_gateway = g,
    gateway_snapshot = COALESCE(s.gateway_snapshot, o.gateway_snapshot),
    mercadopago_payment_id = COALESCE(s.mercadopago_payment_id, CASE WHEN g='mercadopago' THEN o.mercadopago_payment_id END),
    pagarme_order_id = COALESCE(s.pagarme_order_id, CASE WHEN g='pagarme' THEN o.pagarme_order_id END),
    austpay_transaction_id = COALESCE(s.austpay_transaction_id, CASE WHEN g='austpay' THEN o.austpay_transaction_id END),
    appmax_order_id = COALESCE(s.appmax_order_id, CASE WHEN g='appmax' THEN o.appmax_order_id END),
    vindi_transaction_id = COALESCE(s.vindi_transaction_id, CASE WHEN g='vindi' THEN o.vindi_transaction_id END)
  WHERE (s.source_order_id = p_order_id OR (p_pos_sale_id IS NOT NULL AND s.id = p_pos_sale_id))
    AND public._norm_concrete_gateway(s.payment_gateway) IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_order_gateway_to_pos_sales(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_order_gateway_to_pos_sales(uuid, uuid) TO service_role;

-- Na criação da venda a partir do pedido
CREATE OR REPLACE FUNCTION public.trg_pos_sale_inherit_order_gateway()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g text; o record;
BEGIN
  g := public.order_approved_gateway(NEW.source_order_id);
  IF g IS NULL THEN RETURN NEW; END IF;
  SELECT gateway_snapshot, mercadopago_payment_id, pagarme_order_id, austpay_transaction_id, appmax_order_id, vindi_transaction_id
    INTO o FROM public.orders WHERE id = NEW.source_order_id;
  NEW.payment_gateway := g;
  NEW.gateway_snapshot := COALESCE(NEW.gateway_snapshot, o.gateway_snapshot);
  IF g='mercadopago' THEN NEW.mercadopago_payment_id := COALESCE(NEW.mercadopago_payment_id, o.mercadopago_payment_id); END IF;
  IF g='pagarme' THEN NEW.pagarme_order_id := COALESCE(NEW.pagarme_order_id, o.pagarme_order_id); END IF;
  IF g='austpay' THEN NEW.austpay_transaction_id := COALESCE(NEW.austpay_transaction_id, o.austpay_transaction_id); END IF;
  IF g='appmax' THEN NEW.appmax_order_id := COALESCE(NEW.appmax_order_id, o.appmax_order_id); END IF;
  IF g='vindi' THEN NEW.vindi_transaction_id := COALESCE(NEW.vindi_transaction_id, o.vindi_transaction_id); END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_pos_sale_inherit_order_gateway failed: %', SQLERRM;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.trg_pos_sale_inherit_order_gateway() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pos_sale_inherit_order_gateway ON public.pos_sales;
CREATE TRIGGER trg_pos_sale_inherit_order_gateway
  BEFORE INSERT OR UPDATE OF source_order_id ON public.pos_sales
  FOR EACH ROW
  WHEN (NEW.source_order_id IS NOT NULL AND (NEW.payment_gateway IS NULL OR NEW.payment_gateway IN ('', 'store-checkout', 'online', 'shopify')))
  EXECUTE FUNCTION public.trg_pos_sale_inherit_order_gateway();

-- Pagamento que chega depois: estende o trigger existente de pedidos
CREATE OR REPLACE FUNCTION public.sync_order_payment_to_pos_sale()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_paid_stages TEXT[] := ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'];
  v_is_now_paid BOOLEAN;
BEGIN
  v_is_now_paid := COALESCE(NEW.is_paid, FALSE)
                   OR COALESCE(NEW.paid_externally, FALSE)
                   OR (NEW.stage = ANY(v_paid_stages));

  IF v_is_now_paid THEN
    BEGIN
      PERFORM public.apply_order_gateway_to_pos_sales(NEW.id, NEW.pos_sale_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'apply_order_gateway_to_pos_sales failed: %', SQLERRM;
    END;
  END IF;

  IF NEW.pos_sale_id IS NULL OR NOT v_is_now_paid THEN
    RETURN NEW;
  END IF;

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

  IF NEW.payment_method_label IS NOT NULL
     AND OLD.payment_method_label IS DISTINCT FROM NEW.payment_method_label THEN
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
  ELSIF NEW.payment_method_label IS NOT NULL THEN
    UPDATE public.pos_sales s
       SET payment_method = NEW.payment_method_label, updated_at = now()
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

DROP TRIGGER IF EXISTS trg_sync_order_payment_to_pos_sale ON public.orders;
CREATE TRIGGER trg_sync_order_payment_to_pos_sale
  AFTER UPDATE OF is_paid, paid_externally, stage, payment_method_label, gateway_snapshot,
    mercadopago_payment_id, pagarme_order_id, austpay_transaction_id, appmax_order_id, vindi_transaction_id
  ON public.orders FOR EACH ROW
  WHEN (OLD.is_paid IS DISTINCT FROM NEW.is_paid OR OLD.paid_externally IS DISTINCT FROM NEW.paid_externally
     OR OLD.stage IS DISTINCT FROM NEW.stage OR OLD.payment_method_label IS DISTINCT FROM NEW.payment_method_label
     OR OLD.gateway_snapshot IS DISTINCT FROM NEW.gateway_snapshot
     OR OLD.mercadopago_payment_id IS DISTINCT FROM NEW.mercadopago_payment_id
     OR OLD.pagarme_order_id IS DISTINCT FROM NEW.pagarme_order_id
     OR OLD.austpay_transaction_id IS DISTINCT FROM NEW.austpay_transaction_id
     OR OLD.appmax_order_id IS DISTINCT FROM NEW.appmax_order_id
     OR OLD.vindi_transaction_id IS DISTINCT FROM NEW.vindi_transaction_id)
  EXECUTE FUNCTION public.sync_order_payment_to_pos_sale();