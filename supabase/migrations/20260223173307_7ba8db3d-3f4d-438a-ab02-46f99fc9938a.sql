
-- Table to log products that couldn't be scanned and were confirmed manually
CREATE TABLE public.expedition_unscannable_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expedition_order_id UUID NOT NULL REFERENCES expedition_orders(id) ON DELETE CASCADE,
  expedition_order_item_id UUID NOT NULL REFERENCES expedition_order_items(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  sku TEXT,
  barcode TEXT,
  scanned_value TEXT,
  reason TEXT DEFAULT 'manual_override',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.expedition_unscannable_items ENABLE ROW LEVEL SECURITY;

-- Policies - authenticated users can read and insert
CREATE POLICY "Authenticated users can view unscannable items"
  ON public.expedition_unscannable_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert unscannable items"
  ON public.expedition_unscannable_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update unscannable items"
  ON public.expedition_unscannable_items FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Index for quick lookups
CREATE INDEX idx_unscannable_items_order ON public.expedition_unscannable_items(expedition_order_id);
CREATE INDEX idx_unscannable_items_resolved ON public.expedition_unscannable_items(resolved);
