
-- Add cashback/coupon fields to zoppy_customers
ALTER TABLE public.zoppy_customers
  ADD COLUMN IF NOT EXISTS coupon_code TEXT,
  ADD COLUMN IF NOT EXISTS coupon_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS coupon_type TEXT,
  ADD COLUMN IF NOT EXISTS coupon_used BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_min_purchase NUMERIC,
  ADD COLUMN IF NOT EXISTS coupon_expiry_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS coupon_start_date TIMESTAMP WITH TIME ZONE;

-- Index for quick cashback lookups
CREATE INDEX IF NOT EXISTS idx_zoppy_customers_coupon_active 
  ON public.zoppy_customers (coupon_code) 
  WHERE coupon_code IS NOT NULL AND coupon_used = false;

CREATE INDEX IF NOT EXISTS idx_zoppy_customers_phone_coupon
  ON public.zoppy_customers (phone)
  WHERE coupon_code IS NOT NULL AND coupon_used = false;
