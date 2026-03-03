
-- Link Pages (Linktree-style pages per store)
CREATE TABLE public.link_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.pos_stores(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  avatar_url TEXT,
  background_type TEXT NOT NULL DEFAULT 'gradient',
  background_value TEXT NOT NULL DEFAULT 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  theme_config JSONB NOT NULL DEFAULT '{}',
  meta_pixel_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_views INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link Page Items (individual links/buttons)
CREATE TABLE public.link_page_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.link_pages(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'link',
  label TEXT NOT NULL,
  url TEXT,
  icon TEXT,
  description TEXT,
  thumbnail_url TEXT,
  style_config JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link Page Visits (tracking with UTM)
CREATE TABLE public.link_page_visits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.link_pages(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.link_page_items(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'page_view',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_link_pages_slug ON public.link_pages(slug);
CREATE INDEX idx_link_pages_store ON public.link_pages(store_id);
CREATE INDEX idx_link_page_items_page ON public.link_page_items(page_id);
CREATE INDEX idx_link_page_visits_page ON public.link_page_visits(page_id);
CREATE INDEX idx_link_page_visits_created ON public.link_page_visits(created_at);
CREATE INDEX idx_link_page_visits_utm ON public.link_page_visits(utm_source, utm_medium, utm_campaign);

-- Enable RLS
ALTER TABLE public.link_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_page_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_page_visits ENABLE ROW LEVEL SECURITY;

-- RLS: link_pages - authenticated users can manage, everyone can read active
CREATE POLICY "Authenticated users can manage link pages" ON public.link_pages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public can view active link pages" ON public.link_pages FOR SELECT TO anon USING (is_active = true);

-- RLS: link_page_items - authenticated can manage, public can read
CREATE POLICY "Authenticated users can manage link items" ON public.link_page_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public can view active link items" ON public.link_page_items FOR SELECT TO anon USING (is_active = true);

-- RLS: link_page_visits - anyone can insert (tracking), authenticated can read
CREATE POLICY "Anyone can insert visits" ON public.link_page_visits FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can view visits" ON public.link_page_visits FOR SELECT TO authenticated USING (true);

-- Updated_at triggers
CREATE TRIGGER update_link_pages_updated_at BEFORE UPDATE ON public.link_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_link_page_items_updated_at BEFORE UPDATE ON public.link_page_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
