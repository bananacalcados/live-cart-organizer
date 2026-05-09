ALTER TABLE public.catalog_lead_pages
  ADD COLUMN IF NOT EXISTS product_discounts jsonb NOT NULL DEFAULT '{}'::jsonb;