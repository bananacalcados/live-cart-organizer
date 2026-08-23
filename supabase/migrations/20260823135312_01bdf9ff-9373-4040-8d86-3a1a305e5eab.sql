
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS lp_click_id text,
  ADD COLUMN IF NOT EXISTS link_page_id uuid,
  ADD COLUMN IF NOT EXISTS link_page_item_id uuid,
  ADD COLUMN IF NOT EXISTS link_page_catalog_product_id uuid,
  ADD COLUMN IF NOT EXISTS attribution_source text;

CREATE INDEX IF NOT EXISTS idx_pos_sales_lp_click_id ON public.pos_sales (lp_click_id) WHERE lp_click_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_sales_link_page_id ON public.pos_sales (link_page_id) WHERE link_page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_sales_utm_source ON public.pos_sales (utm_source) WHERE utm_source IS NOT NULL;

ALTER TABLE public.link_page_visits
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_value numeric,
  ADD COLUMN IF NOT EXISTS conversion_external_order_id text,
  ADD COLUMN IF NOT EXISTS pos_sale_id uuid;

CREATE INDEX IF NOT EXISTS idx_link_page_visits_click_id ON public.link_page_visits (click_id) WHERE click_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_link_page_visits_converted ON public.link_page_visits (page_id, converted_at) WHERE converted_at IS NOT NULL;
