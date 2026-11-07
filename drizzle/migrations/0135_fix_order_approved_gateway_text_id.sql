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
   WHERE a.sale_id = o.id::text AND a.status = 'success' AND public._norm_concrete_gateway(a.gateway) IS NOT NULL
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