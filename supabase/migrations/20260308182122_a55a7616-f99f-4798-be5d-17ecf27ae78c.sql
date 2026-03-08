
ALTER TABLE public.catalog_lead_registrations
  ADD COLUMN cart_items JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN cart_total NUMERIC DEFAULT 0,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'browsing',
  ADD COLUMN checkout_sale_id UUID,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.catalog_lead_registrations.status IS 'browsing, cart_created, checkout_started, completed, abandoned';
