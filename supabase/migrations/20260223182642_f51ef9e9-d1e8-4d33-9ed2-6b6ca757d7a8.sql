
-- Table for stock check requests from expedition to physical stores
CREATE TABLE public.expedition_stock_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  quantity_needed INTEGER NOT NULL DEFAULT 1,
  to_store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  to_store_name TEXT,
  expedition_order_ids TEXT[] DEFAULT '{}',
  order_names TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  responded_by TEXT,
  has_stock BOOLEAN,
  courier_requested BOOLEAN DEFAULT false,
  courier_name TEXT,
  courier_phone TEXT,
  notes TEXT,
  response_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  responded_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.expedition_stock_requests ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to CRUD (internal tool)
CREATE POLICY "Authenticated users can view stock requests"
  ON public.expedition_stock_requests FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can create stock requests"
  ON public.expedition_stock_requests FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update stock requests"
  ON public.expedition_stock_requests FOR UPDATE
  TO authenticated USING (true);

-- Also allow anon for edge functions
CREATE POLICY "Anon can view stock requests"
  ON public.expedition_stock_requests FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon can create stock requests"
  ON public.expedition_stock_requests FOR INSERT
  TO anon WITH CHECK (true);

CREATE POLICY "Anon can update stock requests"
  ON public.expedition_stock_requests FOR UPDATE
  TO anon USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_expedition_stock_requests_updated_at
  BEFORE UPDATE ON public.expedition_stock_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.expedition_stock_requests;
