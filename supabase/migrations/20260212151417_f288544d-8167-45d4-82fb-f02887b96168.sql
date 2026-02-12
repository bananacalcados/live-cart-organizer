
CREATE TABLE public.pos_product_searches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  product_description TEXT NOT NULL,
  category TEXT,
  brand TEXT,
  size TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  notes TEXT,
  searched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_product_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view product searches"
  ON public.pos_product_searches FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert product searches"
  ON public.pos_product_searches FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete product searches"
  ON public.pos_product_searches FOR DELETE
  TO authenticated USING (true);

CREATE INDEX idx_pos_product_searches_store ON public.pos_product_searches(store_id);
CREATE INDEX idx_pos_product_searches_date ON public.pos_product_searches(searched_at DESC);
