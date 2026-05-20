ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS external_order_id text,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_external_unique
  ON public.pos_sales (external_source, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_sales_store_created_idx
  ON public.pos_sales (store_id, created_at);