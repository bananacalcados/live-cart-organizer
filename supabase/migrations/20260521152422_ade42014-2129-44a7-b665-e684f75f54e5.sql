ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS cashback_balance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS loyalty_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_lifetime_points integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customers_unified_cashback_balance
  ON public.customers_unified (cashback_balance) WHERE cashback_balance > 0;