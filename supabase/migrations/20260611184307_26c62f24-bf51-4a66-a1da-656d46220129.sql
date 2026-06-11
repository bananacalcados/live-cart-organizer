-- ============ Link Pages v2 ============

-- 1. link_pages: novos campos
ALTER TABLE public.link_pages
  ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES public.pos_sellers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS require_lead_capture BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS catalog_auto_sync BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

CREATE INDEX IF NOT EXISTS idx_link_pages_seller ON public.link_pages(seller_id);

-- 2. link_page_items: novos campos
ALTER TABLE public.link_page_items
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prefill_message TEXT,
  ADD COLUMN IF NOT EXISTS card_style TEXT NOT NULL DEFAULT 'compact',
  ADD COLUMN IF NOT EXISTS social_network TEXT;

CREATE INDEX IF NOT EXISTS idx_link_page_items_wa ON public.link_page_items(whatsapp_number_id);

-- 3. link_page_visits: rastreamento por vendedora/lead
ALTER TABLE public.link_page_visits
  ADD COLUMN IF NOT EXISTS seller_id UUID,
  ADD COLUMN IF NOT EXISTS lead_id UUID,
  ADD COLUMN IF NOT EXISTS lead_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_link_page_visits_seller ON public.link_page_visits(seller_id);
CREATE INDEX IF NOT EXISTS idx_link_page_visits_lead ON public.link_page_visits(lead_id);

-- 4. Produtos do catálogo marcados por página
CREATE TABLE IF NOT EXISTS public.link_page_catalog_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.link_pages(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  handle TEXT,
  title TEXT NOT NULL,
  image_url TEXT,
  price NUMERIC,
  compare_at_price NUMERIC,
  product_type TEXT,
  grade_total INTEGER NOT NULL DEFAULT 0,
  grade_available INTEGER NOT NULL DEFAULT 0,
  grade_pct NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_new_arrival BOOLEAN NOT NULL DEFAULT false,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_lpcp_page ON public.link_page_catalog_products(page_id);
CREATE INDEX IF NOT EXISTS idx_lpcp_shopify ON public.link_page_catalog_products(shopify_product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.link_page_catalog_products TO authenticated;
GRANT SELECT ON public.link_page_catalog_products TO anon;
GRANT ALL ON public.link_page_catalog_products TO service_role;

ALTER TABLE public.link_page_catalog_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active catalog products"
  ON public.link_page_catalog_products FOR SELECT TO anon
  USING (is_active = true);
CREATE POLICY "Authenticated manage catalog products"
  ON public.link_page_catalog_products FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_lpcp_updated_at
  BEFORE UPDATE ON public.link_page_catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Leads capturados pela página (gate nome+telefone)
CREATE TABLE IF NOT EXISTS public.link_page_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.link_pages(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES public.pos_sellers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  customer_id UUID,
  is_existing_customer BOOLEAN NOT NULL DEFAULT false,
  ad_lead_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lpl_page ON public.link_page_leads(page_id);
CREATE INDEX IF NOT EXISTS idx_lpl_seller ON public.link_page_leads(seller_id);
CREATE INDEX IF NOT EXISTS idx_lpl_phone ON public.link_page_leads(phone);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.link_page_leads TO authenticated;
GRANT INSERT ON public.link_page_leads TO anon;
GRANT ALL ON public.link_page_leads TO service_role;

ALTER TABLE public.link_page_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can register lead"
  ON public.link_page_leads FOR INSERT TO anon
  WITH CHECK (true);
CREATE POLICY "Authenticated manage leads"
  ON public.link_page_leads FOR ALL TO authenticated
  USING (true) WITH CHECK (true);