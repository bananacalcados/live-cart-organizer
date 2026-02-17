
-- Loyalty configuration per store
CREATE TABLE public.loyalty_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  points_per_real numeric NOT NULL DEFAULT 0.1,
  points_expiry_days integer NOT NULL DEFAULT 365,
  wheel_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id)
);

ALTER TABLE public.loyalty_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access loyalty_config" ON public.loyalty_config FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Customizable prize tiers
CREATE TABLE public.loyalty_prize_tiers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  min_points integer NOT NULL DEFAULT 10,
  prize_type text NOT NULL DEFAULT 'discount_percent',
  prize_value numeric NOT NULL DEFAULT 0,
  prize_label text NOT NULL,
  color text NOT NULL DEFAULT '#FFD700',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_prize_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access loyalty_prize_tiers" ON public.loyalty_prize_tiers FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Customer accumulated points
CREATE TABLE public.customer_loyalty_points (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_phone text NOT NULL,
  customer_name text,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  total_points integer NOT NULL DEFAULT 0,
  lifetime_points integer NOT NULL DEFAULT 0,
  last_earn_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_phone, store_id)
);

ALTER TABLE public.customer_loyalty_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access customer_loyalty_points" ON public.customer_loyalty_points FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Points transaction log
CREATE TABLE public.loyalty_points_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_phone text NOT NULL,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  points integer NOT NULL,
  type text NOT NULL DEFAULT 'earn',
  sale_id uuid,
  prize_id uuid,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_points_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access loyalty_points_log" ON public.loyalty_points_log FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_customer_loyalty_phone_store ON public.customer_loyalty_points(customer_phone, store_id);
CREATE INDEX idx_loyalty_tiers_store ON public.loyalty_prize_tiers(store_id);
CREATE INDEX idx_loyalty_log_phone ON public.loyalty_points_log(customer_phone, store_id);
