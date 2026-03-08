
CREATE TABLE public.catalog_lead_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  theme_config JSONB NOT NULL DEFAULT '{"primaryColor":"#00BFA6","secondaryColor":"#00897B","accentColor":"#004D40","backgroundGradient":"linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)"}'::jsonb,
  selected_product_ids TEXT[] DEFAULT '{}',
  whatsapp_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  require_registration BOOLEAN NOT NULL DEFAULT true,
  views INTEGER NOT NULL DEFAULT 0,
  leads_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_lead_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active catalog lead pages" ON public.catalog_lead_pages
  FOR SELECT USING (is_active = true);

CREATE POLICY "Authenticated can manage catalog lead pages" ON public.catalog_lead_pages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Table for leads captured from catalog pages
CREATE TABLE public.catalog_lead_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_page_id UUID REFERENCES public.catalog_lead_pages(id) ON DELETE CASCADE NOT NULL,
  instagram_handle TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_lead_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert registrations" ON public.catalog_lead_registrations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Authenticated can view registrations" ON public.catalog_lead_registrations
  FOR SELECT TO authenticated USING (true);
