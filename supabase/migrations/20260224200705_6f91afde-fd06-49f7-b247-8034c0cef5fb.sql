
-- Table to cache Tiny ERP sales data for ABC curve analysis
CREATE TABLE public.tiny_sales_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  sku text NOT NULL,
  product_name text,
  quantity_sold numeric NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  sale_count integer NOT NULL DEFAULT 0,
  period_start date NOT NULL,
  period_end date NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, sku, period_start)
);

ALTER TABLE public.tiny_sales_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to tiny_sales_history"
  ON public.tiny_sales_history FOR ALL USING (true) WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_tiny_sales_history_store_sku ON public.tiny_sales_history(store_id, sku);
CREATE INDEX idx_tiny_sales_history_period ON public.tiny_sales_history(store_id, period_start);
