
-- Add columns to pos_sales for online sales tracking
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS sale_type text NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS payment_link text,
  ADD COLUMN IF NOT EXISTS payment_gateway text,
  ADD COLUMN IF NOT EXISTS stock_source_store_id uuid REFERENCES public.pos_stores(id);
