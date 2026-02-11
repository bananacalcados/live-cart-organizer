
-- POS Stores (multi-store with individual Tiny tokens)
CREATE TABLE public.pos_stores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  tiny_token text NOT NULL,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_stores" ON public.pos_stores FOR ALL USING (true) WITH CHECK (true);

-- POS Sellers (synced from Tiny or manual)
CREATE TABLE public.pos_sellers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  tiny_seller_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_sellers" ON public.pos_sellers FOR ALL USING (true) WITH CHECK (true);

-- POS Customers (enriched for CRM)
CREATE TABLE public.pos_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text,
  email text,
  whatsapp text,
  cpf text,
  address text,
  city text,
  state text,
  cep text,
  neighborhood text,
  address_number text,
  complement text,
  age_range text,
  preferred_style text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_customers" ON public.pos_customers FOR ALL USING (true) WITH CHECK (true);

-- POS Sales
CREATE TABLE public.pos_sales (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  seller_id uuid REFERENCES public.pos_sellers(id),
  customer_id uuid REFERENCES public.pos_customers(id),
  tiny_order_id text,
  tiny_invoice_id text,
  invoice_number text,
  invoice_pdf_url text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  payment_method text,
  payment_details jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'completed',
  cash_register_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_sales" ON public.pos_sales FOR ALL USING (true) WITH CHECK (true);

-- POS Sale Items
CREATE TABLE public.pos_sale_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  tiny_product_id text,
  sku text,
  barcode text,
  product_name text NOT NULL,
  variant_name text,
  size text,
  category text,
  unit_price numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  total_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_sale_items" ON public.pos_sale_items FOR ALL USING (true) WITH CHECK (true);

-- Cash Register (open/close)
CREATE TABLE public.pos_cash_registers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  seller_id uuid REFERENCES public.pos_sellers(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_balance numeric NOT NULL DEFAULT 0,
  closing_balance numeric,
  expected_balance numeric,
  cash_sales numeric DEFAULT 0,
  card_sales numeric DEFAULT 0,
  pix_sales numeric DEFAULT 0,
  other_sales numeric DEFAULT 0,
  withdrawals numeric DEFAULT 0,
  deposits numeric DEFAULT 0,
  difference numeric,
  notes text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_cash_registers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_cash_registers" ON public.pos_cash_registers FOR ALL USING (true) WITH CHECK (true);

-- POS Gamification
CREATE TABLE public.pos_gamification (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.pos_sellers(id),
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  total_points integer NOT NULL DEFAULT 0,
  weekly_points integer NOT NULL DEFAULT 0,
  total_sales integer NOT NULL DEFAULT 0,
  complete_registrations integer NOT NULL DEFAULT 0,
  partial_registrations integer NOT NULL DEFAULT 0,
  fast_requests_answered integer NOT NULL DEFAULT 0,
  returns_count integer NOT NULL DEFAULT 0,
  badges jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_gamification ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_gamification" ON public.pos_gamification FOR ALL USING (true) WITH CHECK (true);

-- POS Returns/Exchanges (Phase 2 but create table now)
CREATE TABLE public.pos_returns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  sale_id uuid REFERENCES public.pos_sales(id),
  seller_id uuid REFERENCES public.pos_sellers(id),
  customer_id uuid REFERENCES public.pos_customers(id),
  return_type text NOT NULL DEFAULT 'return',
  reason text NOT NULL DEFAULT 'regret',
  reason_detail text,
  items jsonb NOT NULL DEFAULT '[]',
  refund_amount numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_returns" ON public.pos_returns FOR ALL USING (true) WITH CHECK (true);

-- POS Conditionals (Phase 2 but create table now)
CREATE TABLE public.pos_conditionals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  seller_id uuid REFERENCES public.pos_sellers(id),
  customer_id uuid REFERENCES public.pos_customers(id),
  conditional_type text NOT NULL DEFAULT 'loan',
  items jsonb NOT NULL DEFAULT '[]',
  due_date timestamptz,
  returned_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_conditionals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_conditionals" ON public.pos_conditionals FOR ALL USING (true) WITH CHECK (true);

-- POS Product Requests between stores (Phase 2 but create table now)
CREATE TABLE public.pos_product_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requesting_store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  target_store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  requested_by uuid REFERENCES public.pos_sellers(id),
  answered_by uuid REFERENCES public.pos_sellers(id),
  items jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'normal',
  requested_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  notes text,
  points_awarded boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_product_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_product_requests" ON public.pos_product_requests FOR ALL USING (true) WITH CHECK (true);

-- POS Invoice Config
CREATE TABLE public.pos_invoice_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  auto_emit_on_sale boolean NOT NULL DEFAULT false,
  auto_emit_min_value numeric DEFAULT 0,
  auto_emit_payment_methods text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_invoice_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_invoice_config" ON public.pos_invoice_config FOR ALL USING (true) WITH CHECK (true);

-- Add FK for cash_register_id on pos_sales
ALTER TABLE public.pos_sales ADD CONSTRAINT pos_sales_cash_register_id_fkey FOREIGN KEY (cash_register_id) REFERENCES public.pos_cash_registers(id);

-- Enable realtime for product requests (notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_product_requests;
