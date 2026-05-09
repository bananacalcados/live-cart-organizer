ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shopify_order_id text;
CREATE INDEX IF NOT EXISTS idx_orders_shopify_order_id ON public.orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;