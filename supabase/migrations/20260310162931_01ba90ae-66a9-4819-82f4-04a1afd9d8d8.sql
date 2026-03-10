ALTER TABLE public.events 
  ADD COLUMN catalog_lead_page_id UUID REFERENCES public.catalog_lead_pages(id) ON DELETE SET NULL,
  ADD COLUMN active_product_delay_seconds INTEGER NOT NULL DEFAULT 30;