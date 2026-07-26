CREATE TABLE public.pos_purchase_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID,
  name TEXT NOT NULL,
  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_purchase_lists TO authenticated;
GRANT ALL ON public.pos_purchase_lists TO service_role;
ALTER TABLE public.pos_purchase_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage purchase lists" ON public.pos_purchase_lists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.pos_purchase_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID,
  list_id UUID REFERENCES public.pos_purchase_lists(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  size TEXT,
  sku TEXT,
  barcode TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  requested_by UUID,
  requested_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pos_purchase_requests_store ON public.pos_purchase_requests(store_id, status);
CREATE INDEX idx_pos_purchase_requests_list ON public.pos_purchase_requests(list_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_purchase_requests TO authenticated;
GRANT ALL ON public.pos_purchase_requests TO service_role;
ALTER TABLE public.pos_purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage purchase requests" ON public.pos_purchase_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_pos_purchase_lists_updated_at BEFORE UPDATE ON public.pos_purchase_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pos_purchase_requests_updated_at BEFORE UPDATE ON public.pos_purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();