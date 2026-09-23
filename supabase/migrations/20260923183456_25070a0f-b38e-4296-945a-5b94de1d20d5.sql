CREATE TABLE public.payment_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  seq smallint NOT NULL CHECK (seq BETWEEN 1 AND 4),
  method text NOT NULL CHECK (method IN ('pix','credit','debit')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  charge_amount numeric(12,2) NOT NULL CHECK (charge_amount > 0),
  installments smallint NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 12),
  gateway text,
  gateway_tx_id text,
  request_id text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','refused','expired','refunded','canceled')),
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR sale_id IS NOT NULL)
);
CREATE UNIQUE INDEX payment_splits_order_seq ON public.payment_splits(order_id, seq) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX payment_splits_sale_seq ON public.payment_splits(sale_id, seq) WHERE sale_id IS NOT NULL;
CREATE INDEX payment_splits_tx ON public.payment_splits(gateway_tx_id) WHERE gateway_tx_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_splits TO authenticated;
GRANT ALL ON public.payment_splits TO service_role;
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe gerencia partes de pagamento" ON public.payment_splits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER payment_splits_updated_at BEFORE UPDATE ON public.payment_splits
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

CREATE OR REPLACE FUNCTION public.apply_split_payment(_split_id uuid, _gateway text, _tx_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.payment_splits; paid numeric; total numeric; parts int; paid_parts int;
BEGIN
  SELECT * INTO s FROM public.payment_splits WHERE id = _split_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'split not found'; END IF;
  IF s.status <> 'approved' THEN
    UPDATE public.payment_splits SET status='approved', gateway=_gateway, gateway_tx_id=_tx_id, paid_at=now()
      WHERE id=_split_id;
  END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE status='approved'),0), coalesce(sum(amount),0),
         count(*), count(*) FILTER (WHERE status='approved')
    INTO paid, total, parts, paid_parts
    FROM public.payment_splits
   WHERE (s.order_id IS NOT NULL AND order_id = s.order_id) OR (s.order_id IS NULL AND sale_id = s.sale_id);
  RETURN jsonb_build_object('already_approved', s.status='approved', 'paid_amount', paid, 'total_amount', total,
    'parts', parts, 'paid_parts', paid_parts, 'fully_paid', paid >= total AND total > 0);
END $$;
REVOKE ALL ON FUNCTION public.apply_split_payment(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_split_payment(uuid,text,text) TO service_role;

INSERT INTO public.app_settings(key, value) VALUES ('split_payment_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;