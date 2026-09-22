ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS austpay_transaction_id text;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS austpay_transaction_id text;

CREATE INDEX IF NOT EXISTS idx_orders_austpay_tx ON public.orders (austpay_transaction_id) WHERE austpay_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_sales_austpay_tx ON public.pos_sales (austpay_transaction_id) WHERE austpay_transaction_id IS NOT NULL;

INSERT INTO public.app_settings (key, value)
VALUES ('austpay_enabled', '"false"')
ON CONFLICT (key) DO NOTHING;