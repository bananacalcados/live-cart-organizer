
-- ==========================================
-- TROCAS / DEVOLUÇÕES DO PDV
-- ==========================================
CREATE TABLE public.pos_exchanges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  seller_id UUID REFERENCES public.pos_sellers(id),
  customer_id UUID REFERENCES public.pos_customers(id),
  exchange_type TEXT NOT NULL DEFAULT 'swap', -- swap (troca no ato), credit (vale), difference (troca com diferença)
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, completed, cancelled
  
  -- Produto devolvido
  original_sale_id UUID REFERENCES public.pos_sales(id),
  returned_items JSONB NOT NULL DEFAULT '[]', -- [{product_name, sku, quantity, unit_price}]
  returned_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  return_reason TEXT,
  
  -- Produto novo (para swap/difference)
  new_items JSONB DEFAULT '[]', -- [{product_name, sku, quantity, unit_price}]
  new_total NUMERIC(10,2) DEFAULT 0,
  
  -- Diferença (para difference type)
  difference_amount NUMERIC(10,2) DEFAULT 0, -- positivo = cliente paga, negativo = loja devolve
  difference_payment_method TEXT, -- pix, credito, debito, dinheiro
  
  -- Vale/crédito (para credit type)
  credit_amount NUMERIC(10,2) DEFAULT 0,
  credit_code TEXT,
  credit_used_at TIMESTAMPTZ,
  credit_expires_at TIMESTAMPTZ,
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_exchanges" ON public.pos_exchanges FOR ALL USING (true) WITH CHECK (true);

-- ==========================================
-- SOLICITAÇÕES ENTRE LOJAS
-- ==========================================
CREATE TABLE public.pos_inter_store_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  to_store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  requested_by UUID REFERENCES public.pos_sellers(id), -- vendedora que pediu
  responded_by UUID REFERENCES public.pos_sellers(id), -- vendedora que respondeu
  status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, in_transit, delivered, cancelled, unavailable
  
  -- Produto solicitado
  items JSONB NOT NULL DEFAULT '[]', -- [{product_name, sku, quantity, size, color}]
  
  -- Logística
  courier_name TEXT,
  courier_phone TEXT,
  estimated_arrival TEXT,
  delivered_at TIMESTAMPTZ,
  
  -- Cliente que precisa
  customer_name TEXT,
  customer_phone TEXT,
  
  notes TEXT,
  priority TEXT DEFAULT 'normal', -- normal, urgent
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_inter_store_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pos_inter_store_requests" ON public.pos_inter_store_requests FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for requests (notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_inter_store_requests;
