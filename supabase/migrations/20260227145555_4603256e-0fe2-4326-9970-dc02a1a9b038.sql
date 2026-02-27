
-- Create table for payment receipt photos (comprovantes)
CREATE TABLE public.pos_payment_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  cash_register_id UUID REFERENCES public.pos_cash_registers(id),
  sale_id UUID REFERENCES public.pos_sales(id),
  payment_method TEXT NOT NULL, -- 'cartao_credito', 'cartao_debito', 'pix'
  amount NUMERIC NOT NULL DEFAULT 0,
  receipt_image_url TEXT NOT NULL,
  notes TEXT,
  uploaded_by TEXT, -- seller name or id
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pos_payment_receipts ENABLE ROW LEVEL SECURITY;

-- RLS policies (authenticated users can CRUD)
CREATE POLICY "Authenticated users can view payment receipts"
  ON public.pos_payment_receipts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert payment receipts"
  ON public.pos_payment_receipts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update payment receipts"
  ON public.pos_payment_receipts FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete payment receipts"
  ON public.pos_payment_receipts FOR DELETE
  TO authenticated USING (true);

-- Storage bucket for receipt images
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-receipts', 'payment-receipts', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'payment-receipts');

CREATE POLICY "Anyone can view receipts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'payment-receipts');

CREATE POLICY "Authenticated users can delete receipts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'payment-receipts');
