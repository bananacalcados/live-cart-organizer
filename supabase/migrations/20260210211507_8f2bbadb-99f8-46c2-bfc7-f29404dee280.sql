
-- Create table for Zoppy customers with address, RFM data, and region classification
CREATE TABLE public.zoppy_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  zoppy_id text NOT NULL UNIQUE,
  external_id text,
  first_name text,
  last_name text,
  phone text,
  email text,
  gender text,
  birth_date timestamp with time zone,
  -- Address fields
  address1 text,
  address2 text,
  city text,
  state text,
  postcode text,
  country text,
  -- Zoppy classification
  zoppy_position text,
  -- RFM calculated fields
  rfm_recency_score integer,
  rfm_frequency_score integer,
  rfm_monetary_score integer,
  rfm_total_score integer,
  rfm_segment text,
  rfm_calculated_at timestamp with time zone,
  -- Region classification
  region_type text DEFAULT 'unknown', -- 'local' (loja fisica), 'online', 'unknown'
  ddd text,
  -- Aggregated purchase data
  total_orders integer DEFAULT 0,
  total_spent numeric DEFAULT 0,
  last_purchase_at timestamp with time zone,
  first_purchase_at timestamp with time zone,
  avg_ticket numeric DEFAULT 0,
  -- Timestamps
  zoppy_created_at timestamp with time zone,
  zoppy_updated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.zoppy_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on zoppy_customers" ON public.zoppy_customers FOR ALL USING (true) WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX idx_zoppy_customers_phone ON public.zoppy_customers(phone);
CREATE INDEX idx_zoppy_customers_region ON public.zoppy_customers(region_type);
CREATE INDEX idx_zoppy_customers_rfm_segment ON public.zoppy_customers(rfm_segment);
CREATE INDEX idx_zoppy_customers_ddd ON public.zoppy_customers(ddd);

-- Trigger for updated_at
CREATE TRIGGER update_zoppy_customers_updated_at
  BEFORE UPDATE ON public.zoppy_customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.zoppy_customers;
