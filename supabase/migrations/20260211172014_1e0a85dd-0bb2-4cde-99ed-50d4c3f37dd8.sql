
-- Enable trigram extension for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Table to cache products from Tiny ERP for instant local search
CREATE TABLE public.pos_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  tiny_id BIGINT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  size TEXT,
  color TEXT,
  category TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  barcode TEXT NOT NULL DEFAULT '',
  stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(store_id, tiny_id, sku, variant)
);

-- Indexes for fast search
CREATE INDEX idx_pos_products_store ON public.pos_products(store_id);
CREATE INDEX idx_pos_products_barcode ON public.pos_products(store_id, barcode) WHERE barcode != '';
CREATE INDEX idx_pos_products_name_trgm ON public.pos_products USING gin (name gin_trgm_ops);
CREATE INDEX idx_pos_products_sku ON public.pos_products(store_id, sku);

-- Enable RLS
ALTER TABLE public.pos_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pos_products_select" ON public.pos_products FOR SELECT USING (true);
CREATE POLICY "pos_products_insert" ON public.pos_products FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_products_update" ON public.pos_products FOR UPDATE USING (true);
CREATE POLICY "pos_products_delete" ON public.pos_products FOR DELETE USING (true);

CREATE TRIGGER update_pos_products_updated_at
  BEFORE UPDATE ON public.pos_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Track sync history
CREATE TABLE public.pos_product_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  products_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.pos_product_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos_sync_log_select" ON public.pos_product_sync_log FOR SELECT USING (true);
CREATE POLICY "pos_sync_log_insert" ON public.pos_product_sync_log FOR INSERT WITH CHECK (true);
CREATE POLICY "pos_sync_log_update" ON public.pos_product_sync_log FOR UPDATE USING (true);
