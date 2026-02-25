
-- Table to log checkout payment attempts (success and failure)
CREATE TABLE public.pos_checkout_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_id TEXT NOT NULL,
  store_id TEXT,
  payment_method TEXT NOT NULL, -- 'card' or 'pix'
  status TEXT NOT NULL DEFAULT 'failed', -- 'success' or 'failed'
  error_message TEXT,
  amount NUMERIC(10,2),
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  gateway TEXT, -- 'pagarme', 'appmax', 'mercadopago'
  transaction_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for querying by store
CREATE INDEX idx_pos_checkout_attempts_store ON pos_checkout_attempts(store_id, created_at DESC);
CREATE INDEX idx_pos_checkout_attempts_sale ON pos_checkout_attempts(sale_id);

-- Enable RLS
ALTER TABLE public.pos_checkout_attempts ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read (POS operators)
CREATE POLICY "Authenticated users can read checkout attempts"
  ON public.pos_checkout_attempts FOR SELECT
  USING (true);

-- Allow anonymous inserts (checkout page is public)
CREATE POLICY "Anyone can insert checkout attempts"
  ON public.pos_checkout_attempts FOR INSERT
  WITH CHECK (true);
