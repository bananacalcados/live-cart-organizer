
-- Add pin_code column to pos_sellers
ALTER TABLE public.pos_sellers ADD COLUMN IF NOT EXISTS pin_code TEXT;

-- Create commission tiers table
CREATE TABLE IF NOT EXISTS public.pos_seller_commission_tiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  tier_order INTEGER NOT NULL DEFAULT 0,
  min_revenue NUMERIC NOT NULL DEFAULT 0,
  max_revenue NUMERIC,
  commission_percent NUMERIC NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'monthly',
  period_start DATE,
  period_end DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create commissions ledger table
CREATE TABLE IF NOT EXISTS public.pos_seller_commissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES public.pos_sellers(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_revenue NUMERIC NOT NULL DEFAULT 0,
  tier_id UUID REFERENCES public.pos_seller_commission_tiers(id),
  commission_percent NUMERIC NOT NULL DEFAULT 0,
  commission_value NUMERIC NOT NULL DEFAULT 0,
  bonus_value NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.pos_seller_commission_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_seller_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage commission tiers"
  ON public.pos_seller_commission_tiers FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage commissions"
  ON public.pos_seller_commissions FOR ALL
  USING (true) WITH CHECK (true);
