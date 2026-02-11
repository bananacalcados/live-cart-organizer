
-- Table to map unknown barcodes to known products (persistent aliases)
CREATE TABLE public.inventory_barcode_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  original_barcode TEXT NOT NULL,
  product_tiny_id BIGINT NOT NULL,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one alias per barcode per store
CREATE UNIQUE INDEX idx_barcode_alias_unique ON public.inventory_barcode_aliases(store_id, original_barcode);
CREATE INDEX idx_barcode_alias_store ON public.inventory_barcode_aliases(store_id);

ALTER TABLE public.inventory_barcode_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage barcode aliases" ON public.inventory_barcode_aliases FOR ALL USING (true) WITH CHECK (true);

-- Table to track unresolved barcodes during a count (for later resolution)
CREATE TABLE public.inventory_unresolved_barcodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  barcode TEXT NOT NULL,
  scanned_quantity INT NOT NULL DEFAULT 1,
  photo_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, resolved, ignored
  resolved_product_tiny_id BIGINT,
  resolved_product_name TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unresolved_count ON public.inventory_unresolved_barcodes(count_id);

ALTER TABLE public.inventory_unresolved_barcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage unresolved barcodes" ON public.inventory_unresolved_barcodes FOR ALL USING (true) WITH CHECK (true);

-- Sequence for internal GTIN generation (200 prefix = internal use)
CREATE SEQUENCE public.inventory_gtin_seq START WITH 1;

-- Add trigger for updated_at
CREATE TRIGGER update_unresolved_barcodes_updated_at
  BEFORE UPDATE ON public.inventory_unresolved_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_unresolved_barcodes;
