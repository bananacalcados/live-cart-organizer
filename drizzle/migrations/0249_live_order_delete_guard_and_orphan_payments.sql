CREATE TABLE public.orphan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway text NOT NULL,
  payment_id text NOT NULL,
  external_reference text,
  event_id uuid,
  amount numeric(14,2) NOT NULL,
  payer_name text,
  payer_email text,
  payer_phone text,
  deleted_order_snapshot jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_order_id uuid,
  resolved_by uuid,
  UNIQUE (gateway, payment_id)
);
GRANT SELECT ON public.orphan_payments TO authenticated;
GRANT ALL ON public.orphan_payments TO service_role;
ALTER TABLE public.orphan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Events team reads orphan payments"
ON public.orphan_payments FOR SELECT TO authenticated
USING (public.has_module_access(auth.uid(), 'events'));
CREATE INDEX orphan_payments_event_status_created_idx
ON public.orphan_payments (event_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_order_delete_pending_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_charge boolean := false;
  v_charge_at timestamptz;
BEGIN
  IF session_user = 'postgres' OR current_user = 'service_role' OR session_user = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN OLD;
  END IF;

  IF COALESCE(OLD.is_paid, false) THEN
    RETURN OLD;
  END IF;

  v_has_charge :=
    NULLIF(BTRIM(OLD.mercadopago_payment_id), '') IS NOT NULL OR
    NULLIF(BTRIM(OLD.pagarme_order_id), '') IS NOT NULL OR
    NULLIF(BTRIM(OLD.vindi_transaction_id), '') IS NOT NULL OR
    NULLIF(BTRIM(OLD.appmax_order_id), '') IS NOT NULL OR
    NULLIF(BTRIM(OLD.austpay_transaction_id), '') IS NOT NULL OR
    (OLD.gateway_snapshot IS NOT NULL AND OLD.gateway_snapshot <> 'null'::jsonb) OR
    EXISTS (
      SELECT 1 FROM public.payment_splits ps
      WHERE ps.order_id = OLD.id AND ps.status = 'pending'
    );

  IF NOT v_has_charge THEN
    RETURN OLD;
  END IF;

  BEGIN
    v_charge_at := COALESCE(NULLIF(OLD.gateway_snapshot->>'at', '')::timestamptz, OLD.updated_at);
  EXCEPTION WHEN OTHERS THEN
    v_charge_at := OLD.updated_at;
  END;

  IF v_charge_at >= now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Este pedido tem uma cobrança gerada (Pix/cartão) que a cliente ainda pode pagar. Não exclua: cancele o pedido ou mescle com o outro.';
  END IF;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_order_delete_pending_charge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_order_delete_pending_charge() TO service_role;

CREATE TRIGGER trg_orders_guard_pending_charge_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_delete_pending_charge();