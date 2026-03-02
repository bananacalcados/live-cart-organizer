
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS checkout_step smallint DEFAULT 0;
