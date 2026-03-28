
-- Main categories enum
CREATE TYPE public.exchange_reason_category AS ENUM (
  'tamanho',
  'defeito',
  'nao_gostou',
  'produto_errado',
  'outro'
);

CREATE TYPE public.exchange_status AS ENUM (
  'solicitado',
  'aprovado',
  'aguardando_postagem',
  'em_transito',
  'recebido',
  'concluido',
  'recusado',
  'cancelado'
);

-- Exchange requests table
CREATE TABLE public.exchange_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  customer_name TEXT,
  order_number TEXT,
  tiny_order_id TEXT,
  
  -- Product info
  product_name TEXT NOT NULL,
  product_sku TEXT,
  product_size TEXT,
  desired_size TEXT,
  
  -- Categorization (hybrid)
  reason_category exchange_reason_category NOT NULL DEFAULT 'outro',
  reason_subcategory TEXT,
  ai_nuance_tags TEXT[] DEFAULT '{}',
  customer_verbatim TEXT,
  ai_interpretation TEXT,
  
  -- Shoe-specific fit data
  fit_area TEXT,
  fit_detail TEXT,
  
  -- Logistics
  reverse_shipping_code TEXT,
  reverse_tracking_url TEXT,
  frenet_quote_id TEXT,
  shipping_carrier TEXT,
  
  -- Status & workflow
  status exchange_status NOT NULL DEFAULT 'solicitado',
  auto_approved BOOLEAN DEFAULT false,
  requires_human_review BOOLEAN DEFAULT false,
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  
  -- Ticket link
  support_ticket_id UUID,
  whatsapp_number_id UUID,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.exchange_requests ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage exchange_requests"
  ON public.exchange_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow service role (edge functions)
CREATE POLICY "Service role full access on exchange_requests"
  ON public.exchange_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.exchange_requests;

-- Indexes
CREATE INDEX idx_exchange_requests_phone ON public.exchange_requests(phone);
CREATE INDEX idx_exchange_requests_status ON public.exchange_requests(status);
CREATE INDEX idx_exchange_requests_reason ON public.exchange_requests(reason_category);
CREATE INDEX idx_exchange_requests_product ON public.exchange_requests(product_name);
CREATE INDEX idx_exchange_requests_created ON public.exchange_requests(created_at DESC);

-- Auto update updated_at
CREATE TRIGGER update_exchange_requests_updated_at
  BEFORE UPDATE ON public.exchange_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
