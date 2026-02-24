
-- Sequence for generating EAN-13 internal codes (prefix 200 for internal use)
CREATE SEQUENCE IF NOT EXISTS expedition_beta_barcode_seq START 1;

-- Beta expedition orders table
CREATE TABLE public.expedition_beta_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id TEXT NOT NULL UNIQUE,
  shopify_order_name TEXT,
  shopify_order_number TEXT,
  shopify_created_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  customer_cpf TEXT,
  shipping_address JSONB,
  financial_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT DEFAULT 'unfulfilled',
  expedition_status TEXT NOT NULL DEFAULT 'approved',
  subtotal_price NUMERIC,
  total_price NUMERIC,
  total_discount NUMERIC,
  total_shipping NUMERIC,
  total_weight_grams INTEGER,
  has_gift BOOLEAN NOT NULL DEFAULT false,
  is_from_live BOOLEAN NOT NULL DEFAULT false,
  source_event_name TEXT,
  source_event_date TEXT,
  notes TEXT,
  group_id UUID,
  picking_list_id UUID,
  internal_barcode TEXT,
  ean13_barcode TEXT,
  dispatch_verified BOOLEAN DEFAULT false,
  dispatch_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Beta expedition order items
CREATE TABLE public.expedition_beta_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expedition_order_id UUID NOT NULL REFERENCES public.expedition_beta_orders(id) ON DELETE CASCADE,
  shopify_line_item_id TEXT,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  sku TEXT,
  barcode TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC,
  weight_grams INTEGER,
  picked_quantity INTEGER DEFAULT 0,
  pick_verified BOOLEAN DEFAULT false,
  packed_quantity INTEGER DEFAULT 0,
  pack_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_beta_orders_status ON public.expedition_beta_orders(expedition_status);
CREATE INDEX idx_beta_orders_shopify_id ON public.expedition_beta_orders(shopify_order_id);
CREATE INDEX idx_beta_orders_created ON public.expedition_beta_orders(shopify_created_at DESC);
CREATE INDEX idx_beta_items_order ON public.expedition_beta_order_items(expedition_order_id);

-- Enable RLS
ALTER TABLE public.expedition_beta_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_beta_order_items ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern as expedition_orders - open for authenticated users)
CREATE POLICY "Authenticated users can view beta orders" ON public.expedition_beta_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert beta orders" ON public.expedition_beta_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update beta orders" ON public.expedition_beta_orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete beta orders" ON public.expedition_beta_orders FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view beta items" ON public.expedition_beta_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert beta items" ON public.expedition_beta_order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update beta items" ON public.expedition_beta_order_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete beta items" ON public.expedition_beta_order_items FOR DELETE TO authenticated USING (true);

-- Service role policies for webhook inserts
CREATE POLICY "Service role can manage beta orders" ON public.expedition_beta_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage beta items" ON public.expedition_beta_order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.expedition_beta_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.expedition_beta_order_items;

-- Updated_at trigger
CREATE TRIGGER update_beta_orders_updated_at
  BEFORE UPDATE ON public.expedition_beta_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to generate EAN-13 barcode from sequence
CREATE OR REPLACE FUNCTION public.generate_ean13_barcode()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
DECLARE
  seq_val BIGINT;
  code_str TEXT;
  check_digit INTEGER;
  sum_val INTEGER := 0;
  i INTEGER;
  digit INTEGER;
BEGIN
  -- Get next sequence value
  seq_val := nextval('expedition_beta_barcode_seq');
  
  -- Build 12-digit code: prefix "200" (internal use) + 9-digit padded sequence
  code_str := '200' || LPAD(seq_val::TEXT, 9, '0');
  
  -- Calculate EAN-13 check digit
  FOR i IN 1..12 LOOP
    digit := CAST(SUBSTRING(code_str FROM i FOR 1) AS INTEGER);
    IF i % 2 = 0 THEN
      sum_val := sum_val + digit * 3;
    ELSE
      sum_val := sum_val + digit;
    END IF;
  END LOOP;
  
  check_digit := (10 - (sum_val % 10)) % 10;
  
  RETURN code_str || check_digit::TEXT;
END;
$$;
