ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS setup_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_shipping_threshold numeric,
  ADD COLUMN IF NOT EXISTS installment_min_value numeric,
  ADD COLUMN IF NOT EXISTS installment_max integer;