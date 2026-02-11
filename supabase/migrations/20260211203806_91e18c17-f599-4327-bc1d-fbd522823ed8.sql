
-- Sessões de balanço/contagem de estoque
CREATE TABLE public.inventory_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  scope TEXT NOT NULL DEFAULT 'total', -- 'total' or 'partial'
  categories TEXT[] DEFAULT '{}', -- categories for partial scope
  status TEXT NOT NULL DEFAULT 'counting', -- counting, reviewing, correcting, completed
  total_products INTEGER DEFAULT 0,
  counted_products INTEGER DEFAULT 0,
  divergent_products INTEGER DEFAULT 0,
  corrected_products INTEGER DEFAULT 0,
  correction_errors INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Itens bipados/contados em cada balanço
CREATE TABLE public.inventory_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL, -- tiny product id
  product_name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  counted_quantity INTEGER NOT NULL DEFAULT 0,
  current_stock DECIMAL, -- saldo no Tiny no momento da consulta
  divergence DECIMAL, -- counted - current
  correction_status TEXT DEFAULT 'pending', -- pending, correcting, corrected, error, skipped
  correction_error TEXT,
  corrected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fila de correções para processar em background
CREATE TABLE public.inventory_correction_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  count_item_id UUID NOT NULL REFERENCES public.inventory_count_items(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  new_quantity INTEGER NOT NULL,
  old_quantity DECIMAL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, error
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_inventory_count_items_count_id ON public.inventory_count_items(count_id);
CREATE INDEX idx_inventory_count_items_barcode ON public.inventory_count_items(barcode);
CREATE INDEX idx_inventory_count_items_sku ON public.inventory_count_items(sku);
CREATE INDEX idx_inventory_correction_queue_count_id ON public.inventory_correction_queue(count_id);
CREATE INDEX idx_inventory_correction_queue_status ON public.inventory_correction_queue(status);

-- RLS
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_correction_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON public.inventory_counts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.inventory_count_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.inventory_correction_queue FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_counts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_count_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_correction_queue;

-- Triggers
CREATE TRIGGER update_inventory_counts_updated_at BEFORE UPDATE ON public.inventory_counts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_inventory_count_items_updated_at BEFORE UPDATE ON public.inventory_count_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_inventory_correction_queue_updated_at BEFORE UPDATE ON public.inventory_correction_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
