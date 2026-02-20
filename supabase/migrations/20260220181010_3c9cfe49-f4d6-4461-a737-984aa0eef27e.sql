
-- Table to store catalog-style landing pages with product selection
CREATE TABLE public.catalog_landing_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Visual customization
  theme_config JSONB NOT NULL DEFAULT '{
    "primaryColor": "#00BFA6",
    "secondaryColor": "#00897B",
    "accentColor": "#004D40",
    "buttonWhatsappColor": "#25D366",
    "buttonStoreColor": "#7C3AED",
    "backgroundGradient": "linear-gradient(160deg, #00BFA6 0%, #00897B 50%, #004D40 100%)"
  }'::jsonb,
  
  -- Campaign content
  welcome_title TEXT NOT NULL DEFAULT 'Confira nossos produtos!',
  welcome_subtitle TEXT,
  combo_tiers JSONB DEFAULT '[{"qty":"1 par","price":"R$ 150"},{"qty":"2 pares","price":"R$ 240"},{"qty":"3 pares","price":"R$ 300"}]'::jsonb,
  payment_info TEXT DEFAULT 'Até 6x sem juros no cartão ou 15% cashback no Pix',
  cta_text TEXT NOT NULL DEFAULT 'Ver Produtos 👀',
  
  -- Categories (user can customize which categories appear)
  categories JSONB NOT NULL DEFAULT '[
    {"key":"todos","label":"Todos","emoji":"👟"},
    {"key":"tenis","label":"Tênis","emoji":"👟"},
    {"key":"salto","label":"Salto","emoji":"👠"},
    {"key":"papete","label":"Papete","emoji":"🩴"},
    {"key":"rasteira","label":"Rasteira","emoji":"🥿"},
    {"key":"sandalia","label":"Sandália","emoji":"👡"},
    {"key":"bota","label":"Bota","emoji":"🥾"}
  ]'::jsonb,
  
  -- WhatsApp round-robin numbers
  whatsapp_numbers JSONB NOT NULL DEFAULT '[
    {"name":"Banana Calçados","number":"5533936180084"},
    {"name":"Zoppy","number":"5533935050288"}
  ]'::jsonb,
  
  -- Product selection: list of Shopify product handles or IDs to include
  -- If empty, shows all products matching the filter
  selected_product_ids TEXT[] DEFAULT '{}',
  
  -- Filter config (e.g. size filter)
  product_filter JSONB DEFAULT '{"sizeFilter":"34","filterBySize":true}'::jsonb,
  
  -- Store link base URL
  store_base_url TEXT NOT NULL DEFAULT 'https://bananacalcados.com.br',
  
  -- Stats
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_landing_pages ENABLE ROW LEVEL SECURITY;

-- Public read for rendering pages
CREATE POLICY "Anyone can view active catalog landing pages"
ON public.catalog_landing_pages FOR SELECT
USING (is_active = true);

-- Authenticated users can manage
CREATE POLICY "Authenticated users can manage catalog landing pages"
ON public.catalog_landing_pages FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Auto-update timestamp
CREATE TRIGGER update_catalog_landing_pages_updated_at
BEFORE UPDATE ON public.catalog_landing_pages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
