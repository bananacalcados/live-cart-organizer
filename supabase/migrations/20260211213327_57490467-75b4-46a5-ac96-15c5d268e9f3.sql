
-- Table to store orders synced from Tiny ERP for management analytics
CREATE TABLE public.tiny_synced_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  tiny_order_id text NOT NULL,
  tiny_order_number text,
  order_date date NOT NULL,
  customer_name text,
  status text,
  payment_method text,
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  shipping numeric DEFAULT 0,
  total numeric DEFAULT 0,
  items jsonb DEFAULT '[]'::jsonb,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, tiny_order_id)
);

ALTER TABLE public.tiny_synced_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to tiny_synced_orders" ON public.tiny_synced_orders FOR ALL USING (true);

CREATE INDEX idx_tiny_synced_orders_store_date ON public.tiny_synced_orders(store_id, order_date);
CREATE INDEX idx_tiny_synced_orders_date ON public.tiny_synced_orders(order_date);

-- Sync log table
CREATE TABLE public.tiny_management_sync_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES public.pos_stores(id),
  sync_type text NOT NULL DEFAULT 'orders',
  status text NOT NULL DEFAULT 'running',
  orders_synced integer DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.tiny_management_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to tiny_management_sync_log" ON public.tiny_management_sync_log FOR ALL USING (true);

-- Add cost_price to pos_products if not exists
ALTER TABLE public.pos_products ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0;
