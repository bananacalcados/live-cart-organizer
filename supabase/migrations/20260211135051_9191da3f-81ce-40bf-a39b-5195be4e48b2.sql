
-- ============================================
-- EXPEDITION MANAGEMENT SYSTEM TABLES
-- ============================================

-- 1. Expedition Orders (synced from Shopify)
CREATE TABLE public.expedition_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id TEXT NOT NULL UNIQUE,
  shopify_order_number TEXT,
  shopify_order_name TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  customer_cpf TEXT,
  shipping_address JSONB,
  financial_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT,
  total_price NUMERIC(10,2) DEFAULT 0,
  subtotal_price NUMERIC(10,2) DEFAULT 0,
  total_shipping NUMERIC(10,2) DEFAULT 0,
  total_discount NUMERIC(10,2) DEFAULT 0,
  total_weight_grams INTEGER DEFAULT 0,
  shopify_created_at TIMESTAMPTZ,
  
  -- Expedition workflow
  expedition_status TEXT NOT NULL DEFAULT 'pending_sync',
  -- pending_sync, approved, grouped, picking, picked, packing, packed, 
  -- freight_quoted, invoice_issued, label_generated, dispatch_verified, dispatched
  
  group_id UUID,
  picking_list_id UUID,
  
  -- Freight
  freight_carrier TEXT,
  freight_service TEXT,
  freight_price NUMERIC(10,2),
  freight_delivery_days INTEGER,
  freight_tracking_code TEXT,
  freight_label_url TEXT,
  
  -- Invoice (NF-e via Tiny ERP)
  tiny_order_id TEXT,
  invoice_number TEXT,
  invoice_series TEXT,
  invoice_key TEXT,
  invoice_pdf_url TEXT,
  invoice_xml_url TEXT,
  
  -- Internal barcode for dispatch verification
  internal_barcode TEXT,
  dispatch_verified BOOLEAN DEFAULT FALSE,
  dispatch_verified_at TIMESTAMPTZ,
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Expedition Order Items
CREATE TABLE public.expedition_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expedition_order_id UUID NOT NULL REFERENCES public.expedition_orders(id) ON DELETE CASCADE,
  shopify_line_item_id TEXT,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  sku TEXT,
  barcode TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) DEFAULT 0,
  weight_grams INTEGER DEFAULT 0,
  
  -- Picking/Packing verification
  picked_quantity INTEGER DEFAULT 0,
  packed_quantity INTEGER DEFAULT 0,
  pick_verified BOOLEAN DEFAULT FALSE,
  pack_verified BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Customer Order Groups (for combining shipments)
CREATE TABLE public.expedition_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_email TEXT,
  customer_name TEXT,
  order_count INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign key for group_id
ALTER TABLE public.expedition_orders 
ADD CONSTRAINT expedition_orders_group_id_fkey 
FOREIGN KEY (group_id) REFERENCES public.expedition_groups(id) ON DELETE SET NULL;

-- 4. Picking Lists
CREATE TABLE public.expedition_picking_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, in_progress, completed
  total_items INTEGER DEFAULT 0,
  picked_items INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign key for picking_list_id
ALTER TABLE public.expedition_orders 
ADD CONSTRAINT expedition_orders_picking_list_id_fkey 
FOREIGN KEY (picking_list_id) REFERENCES public.expedition_picking_lists(id) ON DELETE SET NULL;

-- 5. Freight Quotes (history)
CREATE TABLE public.expedition_freight_quotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expedition_order_id UUID NOT NULL REFERENCES public.expedition_orders(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL,
  service TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  delivery_days INTEGER,
  error_message TEXT,
  is_selected BOOLEAN DEFAULT FALSE,
  quoted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Dispatch Manifests (romaneio)
CREATE TABLE public.expedition_dispatch_manifests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  carrier TEXT NOT NULL,
  manifest_number TEXT,
  order_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, ready, collected, signed
  collector_name TEXT,
  collected_at TIMESTAMPTZ,
  signature_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Dispatch Manifest Items
CREATE TABLE public.expedition_dispatch_manifest_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  manifest_id UUID NOT NULL REFERENCES public.expedition_dispatch_manifests(id) ON DELETE CASCADE,
  expedition_order_id UUID NOT NULL REFERENCES public.expedition_orders(id) ON DELETE CASCADE,
  tracking_code TEXT,
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Returns & Exchanges (logística reversa)
CREATE TABLE public.expedition_returns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expedition_order_id UUID REFERENCES public.expedition_orders(id) ON DELETE SET NULL,
  shopify_order_name TEXT,
  customer_name TEXT,
  customer_email TEXT,
  return_type TEXT NOT NULL DEFAULT 'return',
  -- return, exchange
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending, approved, in_transit, received, inspected, completed, rejected
  items JSONB DEFAULT '[]'::jsonb,
  tracking_code TEXT,
  received_at TIMESTAMPTZ,
  inspected_at TIMESTAMPTZ,
  inspection_notes TEXT,
  refund_amount NUMERIC(10,2),
  exchange_order_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Expedition Sync Log
CREATE TABLE public.expedition_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_type TEXT NOT NULL DEFAULT 'shopify_orders',
  status TEXT NOT NULL DEFAULT 'running',
  orders_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS on all tables
ALTER TABLE public.expedition_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_picking_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_freight_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_dispatch_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_dispatch_manifest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedition_sync_log ENABLE ROW LEVEL SECURITY;

-- Public access policies (internal tool, no auth required)
CREATE POLICY "Allow all access to expedition_orders" ON public.expedition_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_order_items" ON public.expedition_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_groups" ON public.expedition_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_picking_lists" ON public.expedition_picking_lists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_freight_quotes" ON public.expedition_freight_quotes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_dispatch_manifests" ON public.expedition_dispatch_manifests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_dispatch_manifest_items" ON public.expedition_dispatch_manifest_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_returns" ON public.expedition_returns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expedition_sync_log" ON public.expedition_sync_log FOR ALL USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_expedition_orders_shopify_id ON public.expedition_orders(shopify_order_id);
CREATE INDEX idx_expedition_orders_status ON public.expedition_orders(expedition_status);
CREATE INDEX idx_expedition_orders_financial ON public.expedition_orders(financial_status);
CREATE INDEX idx_expedition_orders_group ON public.expedition_orders(group_id);
CREATE INDEX idx_expedition_order_items_order ON public.expedition_order_items(expedition_order_id);
CREATE INDEX idx_expedition_order_items_barcode ON public.expedition_order_items(barcode);
CREATE INDEX idx_expedition_freight_quotes_order ON public.expedition_freight_quotes(expedition_order_id);
CREATE INDEX idx_expedition_returns_order ON public.expedition_returns(expedition_order_id);
CREATE INDEX idx_expedition_returns_status ON public.expedition_returns(status);

-- Triggers for updated_at
CREATE TRIGGER update_expedition_orders_updated_at BEFORE UPDATE ON public.expedition_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_expedition_groups_updated_at BEFORE UPDATE ON public.expedition_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_expedition_picking_lists_updated_at BEFORE UPDATE ON public.expedition_picking_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_expedition_dispatch_manifests_updated_at BEFORE UPDATE ON public.expedition_dispatch_manifests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_expedition_returns_updated_at BEFORE UPDATE ON public.expedition_returns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.expedition_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.expedition_returns;
