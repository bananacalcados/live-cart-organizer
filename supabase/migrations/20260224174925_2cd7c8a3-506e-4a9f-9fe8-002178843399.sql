ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS payment_method_detail text;