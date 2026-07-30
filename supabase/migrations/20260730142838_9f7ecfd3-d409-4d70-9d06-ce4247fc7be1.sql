
CREATE TABLE public.event_prize_wheels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  audience text NOT NULL DEFAULT 'participants' CHECK (audience IN ('payers','participants')),
  is_active boolean NOT NULL DEFAULT false,
  min_purchase_value numeric NOT NULL DEFAULT 0,
  require_otp boolean NOT NULL DEFAULT true,
  max_spins_per_customer integer NOT NULL DEFAULT 1,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_prize_wheels_event ON public.event_prize_wheels(event_id, is_active);

CREATE TABLE public.event_prize_wheel_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wheel_id uuid NOT NULL REFERENCES public.event_prize_wheels(id) ON DELETE CASCADE,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#FF6B00',
  prize_type text NOT NULL DEFAULT 'discount_percent'
    CHECK (prize_type IN ('discount_percent','discount_fixed','free_shipping','product','none')),
  prize_value numeric NOT NULL DEFAULT 0,
  probability numeric NOT NULL DEFAULT 1,
  expiry_days integer NOT NULL DEFAULT 30,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_prize_wheel_segments_wheel ON public.event_prize_wheel_segments(wheel_id);

CREATE TABLE public.event_prize_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wheel_id uuid NOT NULL REFERENCES public.event_prize_wheels(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  phone text NOT NULL,
  phone_suffix text,
  customer_name text,
  segment_id uuid REFERENCES public.event_prize_wheel_segments(id) ON DELETE SET NULL,
  prize_id uuid REFERENCES public.customer_prizes(id) ON DELETE SET NULL,
  prize_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_prize_spins_wheel_phone ON public.event_prize_spins(wheel_id, phone);

ALTER TABLE public.customer_prizes
  ADD COLUMN IF NOT EXISTS event_id uuid,
  ADD COLUMN IF NOT EXISTS wheel_id uuid,
  ADD COLUMN IF NOT EXISTS event_segment_id uuid,
  ADD COLUMN IF NOT EXISTS applied_order_id uuid;

ALTER TABLE public.customer_prizes ALTER COLUMN store_id DROP NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_prize_wheels TO authenticated;
GRANT ALL ON public.event_prize_wheels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_prize_wheel_segments TO authenticated;
GRANT ALL ON public.event_prize_wheel_segments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_prize_spins TO authenticated;
GRANT ALL ON public.event_prize_spins TO service_role;

ALTER TABLE public.event_prize_wheels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_prize_wheel_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_prize_spins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage event_prize_wheels" ON public.event_prize_wheels
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage event_prize_wheel_segments" ON public.event_prize_wheel_segments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage event_prize_spins" ON public.event_prize_spins
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_event_prize_wheels_updated_at BEFORE UPDATE ON public.event_prize_wheels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_event_prize_wheel_segments_updated_at BEFORE UPDATE ON public.event_prize_wheel_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.apply_event_prize_to_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_phone   text;
  v_suffix  text;
  v_prize   public.customer_prizes%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found'); END IF;
  IF v_order.is_paid THEN RETURN jsonb_build_object('applied', false, 'reason', 'order_paid'); END IF;
  IF COALESCE(v_order.coupon_code, '') <> '' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'coupon_already_applied');
  END IF;

  SELECT c.whatsapp INTO v_phone FROM public.customers c WHERE c.id = v_order.customer_id;
  IF v_phone IS NULL THEN RETURN jsonb_build_object('applied', false, 'reason', 'no_phone'); END IF;
  v_suffix := right(regexp_replace(v_phone, '\D', '', 'g'), 8);

  SELECT * INTO v_prize
  FROM public.customer_prizes p
  WHERE p.is_redeemed = false
    AND p.expires_at > now()
    AND p.prize_type IN ('discount_percent','discount_fixed','free_shipping')
    AND right(regexp_replace(p.customer_phone, '\D', '', 'g'), 8) = v_suffix
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'no_prize'); END IF;

  IF v_prize.prize_type = 'free_shipping' THEN
    UPDATE public.orders
      SET free_shipping = true, shipping_cost = 0, coupon_code = v_prize.coupon_code
      WHERE id = p_order_id;
  ELSIF v_prize.prize_type = 'discount_percent' THEN
    UPDATE public.orders
      SET discount_type = 'percentage', discount_value = v_prize.prize_value, coupon_code = v_prize.coupon_code
      WHERE id = p_order_id;
  ELSE
    UPDATE public.orders
      SET discount_type = 'fixed', discount_value = v_prize.prize_value, coupon_code = v_prize.coupon_code
      WHERE id = p_order_id;
  END IF;

  UPDATE public.customer_prizes
    SET is_redeemed = true, redeemed_at = now(), applied_order_id = p_order_id
    WHERE id = v_prize.id;

  RETURN jsonb_build_object(
    'applied', true,
    'prize_label', v_prize.prize_label,
    'prize_type', v_prize.prize_type,
    'prize_value', v_prize.prize_value,
    'coupon_code', v_prize.coupon_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_event_prize_to_order(uuid) TO authenticated, service_role;
