
-- Prize wheel configuration: each segment on the wheel
CREATE TABLE public.prize_wheel_segments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#FF6B00',
  prize_type text NOT NULL DEFAULT 'discount_percent',
  prize_value numeric NOT NULL DEFAULT 0,
  probability numeric NOT NULL DEFAULT 10,
  expiry_days integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Customer prizes: awarded prizes stored per customer
CREATE TABLE public.customer_prizes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_phone text NOT NULL,
  customer_name text,
  customer_email text,
  store_id uuid REFERENCES public.pos_stores(id),
  segment_id uuid REFERENCES public.prize_wheel_segments(id),
  prize_label text NOT NULL,
  prize_type text NOT NULL,
  prize_value numeric NOT NULL DEFAULT 0,
  coupon_code text NOT NULL,
  is_redeemed boolean NOT NULL DEFAULT false,
  redeemed_at timestamptz,
  redeemed_sale_id text,
  expires_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'wheel',
  live_session_id uuid,
  campaign_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.prize_wheel_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_prizes ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated access only
CREATE POLICY "Auth access prize_wheel_segments"
  ON public.prize_wheel_segments FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth access customer_prizes"
  ON public.customer_prizes FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_customer_prizes_phone ON public.customer_prizes(customer_phone);
CREATE INDEX idx_customer_prizes_coupon ON public.customer_prizes(coupon_code);
CREATE INDEX idx_prize_wheel_segments_store ON public.prize_wheel_segments(store_id);

-- Triggers for updated_at
CREATE TRIGGER update_prize_wheel_segments_updated_at
  BEFORE UPDATE ON public.prize_wheel_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customer_prizes_updated_at
  BEFORE UPDATE ON public.customer_prizes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
