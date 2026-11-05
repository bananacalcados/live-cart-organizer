CREATE TABLE public.webhook_verification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  source text NOT NULL DEFAULT 'live',
  event_type text,
  external_id text,
  transaction_id text,
  order_id text,
  sale_id text,
  verified boolean NOT NULL DEFAULT false,
  api_status text,
  api_amount numeric,
  expected_amount numeric,
  old_decision text,
  new_decision text,
  reason text,
  strict_mode boolean NOT NULL DEFAULT false,
  applied boolean NOT NULL DEFAULT false,
  details jsonb
);
GRANT SELECT ON public.webhook_verification_log TO authenticated;
GRANT ALL ON public.webhook_verification_log TO service_role;
ALTER TABLE public.webhook_verification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read webhook verification" ON public.webhook_verification_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX webhook_verification_log_tx_idx ON public.webhook_verification_log (provider, transaction_id);
CREATE INDEX webhook_verification_log_created_idx ON public.webhook_verification_log (created_at DESC);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS payment_review_required boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS orders_payment_review_idx ON public.orders (id) WHERE payment_review_required;
CREATE INDEX IF NOT EXISTS pos_sales_payment_review_idx ON public.pos_sales (id) WHERE payment_review_required;

INSERT INTO public.app_settings (key, value) VALUES ('webhook_strict_mode', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;