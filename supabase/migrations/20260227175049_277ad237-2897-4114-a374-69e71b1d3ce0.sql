
CREATE TABLE pos_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES pos_stores(id),
  product_id UUID REFERENCES pos_products(id),
  tiny_id BIGINT NOT NULL,
  sku TEXT,
  barcode TEXT,
  product_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  quantity NUMERIC NOT NULL,
  previous_stock NUMERIC,
  new_stock NUMERIC,
  reason TEXT,
  seller_id UUID REFERENCES pos_sellers(id),
  seller_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pos_stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage stock adjustments"
ON pos_stock_adjustments
FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);
