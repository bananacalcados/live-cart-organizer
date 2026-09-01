ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS phone_suffix8 text
  GENERATED ALWAYS AS (right(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g'), 8)) STORED;

CREATE INDEX IF NOT EXISTS idx_pos_sales_phone_suffix8 ON public.pos_sales (phone_suffix8);
CREATE INDEX IF NOT EXISTS idx_pos_sales_phone_suffix8_created ON public.pos_sales (phone_suffix8, created_at DESC);

ALTER TABLE public.zoppy_sales
  ADD COLUMN IF NOT EXISTS phone_suffix8 text
  GENERATED ALWAYS AS (right(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g'), 8)) STORED;

CREATE INDEX IF NOT EXISTS idx_zoppy_sales_phone_suffix8 ON public.zoppy_sales (phone_suffix8);