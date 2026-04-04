
CREATE TABLE public.ai_assistance_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('product_photo', 'takeover_chat', 'verify_stock', 'technical_info')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'expired')),
  customer_phone TEXT,
  customer_name TEXT,
  product_title TEXT,
  shopify_product_id TEXT,
  store_id UUID REFERENCES public.pos_stores(id),
  ai_agent TEXT NOT NULL DEFAULT 'jess',
  ai_summary TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  seller_id UUID,
  response_notes TEXT,
  response_media_url TEXT,
  whatsapp_number_id UUID,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_assistance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ai_assistance_requests"
  ON public.ai_assistance_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert ai_assistance_requests"
  ON public.ai_assistance_requests FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ai_assistance_requests"
  ON public.ai_assistance_requests FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Service role full access ai_assistance_requests"
  ON public.ai_assistance_requests FOR ALL USING (true);

CREATE INDEX idx_ai_assistance_requests_store ON public.ai_assistance_requests(store_id, status);
CREATE INDEX idx_ai_assistance_requests_status ON public.ai_assistance_requests(status, created_at DESC);

CREATE TRIGGER update_ai_assistance_requests_updated_at
  BEFORE UPDATE ON public.ai_assistance_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_assistance_requests;
