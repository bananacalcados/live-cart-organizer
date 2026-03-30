
-- Shipping rules: global or per-event overrides for carrier pricing
CREATE TABLE public.shipping_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE DEFAULT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Rule type: 'fixed_price', 'discount_percentage', 'discount_fixed'
  rule_type TEXT NOT NULL DEFAULT 'fixed_price',
  -- Carrier matching (case-insensitive ILIKE). NULL = all carriers
  carrier_match TEXT DEFAULT NULL,
  -- Region matching: NULL = all, or array of state codes like ['SP','RJ','MG']
  region_states TEXT[] DEFAULT NULL,
  -- CEP range matching (optional)
  cep_range_start TEXT DEFAULT NULL,
  cep_range_end TEXT DEFAULT NULL,
  -- Values
  fixed_price NUMERIC DEFAULT NULL,
  discount_percentage NUMERIC DEFAULT NULL,
  discount_fixed NUMERIC DEFAULT NULL,
  -- Priority: higher = applied first when multiple rules match
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shipping_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage shipping rules"
  ON public.shipping_rules FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_shipping_rules_updated_at
  BEFORE UPDATE ON public.shipping_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
