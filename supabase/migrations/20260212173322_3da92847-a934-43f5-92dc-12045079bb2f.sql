-- Internal cashback coupons system
CREATE TABLE public.internal_cashback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  origin_type TEXT NOT NULL DEFAULT 'auto_45days',
  cashback_amount NUMERIC(10,2) NOT NULL,
  min_purchase NUMERIC(10,2) NOT NULL,
  coupon_code TEXT NOT NULL UNIQUE,
  is_used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  used_sale_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_cashback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to internal_cashback" ON public.internal_cashback FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_internal_cashback_phone ON public.internal_cashback(customer_phone);
CREATE INDEX idx_internal_cashback_code ON public.internal_cashback(coupon_code);

-- Trigger for updated_at
CREATE TRIGGER update_internal_cashback_updated_at
  BEFORE UPDATE ON public.internal_cashback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();