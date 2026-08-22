ALTER TABLE public.link_page_catalog_products ADD COLUMN IF NOT EXISTS clicks integer NOT NULL DEFAULT 0;
ALTER TABLE public.link_page_visits ADD COLUMN IF NOT EXISTS catalog_product_id uuid REFERENCES public.link_page_catalog_products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_link_page_visits_catalog_product ON public.link_page_visits(catalog_product_id);