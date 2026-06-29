-- 1) Offers configured per event
CREATE TABLE public.event_crossell_offers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  product_title text,
  variant_handle text,
  image text,
  has_sizes boolean NOT NULL DEFAULT false,
  original_price numeric NOT NULL DEFAULT 0,
  discount_price numeric NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_crossell_offers TO authenticated;
GRANT ALL ON public.event_crossell_offers TO service_role;

ALTER TABLE public.event_crossell_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage crossell offers"
  ON public.event_crossell_offers FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_event_crossell_offers_event ON public.event_crossell_offers(event_id);

-- 2) Crossell items added to a specific order via the checkout link
CREATE TABLE public.order_crossell_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id uuid,
  offer_id uuid REFERENCES public.event_crossell_offers(id) ON DELETE SET NULL,
  shopify_product_id text,
  shopify_variant_id text,
  title text,
  color text,
  size text,
  image text,
  original_price numeric NOT NULL DEFAULT 0,
  discount_price numeric NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  added_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Prevent the same variant being added twice to the same order
CREATE UNIQUE INDEX uq_order_crossell_variant
  ON public.order_crossell_items(order_id, shopify_variant_id);
CREATE INDEX idx_order_crossell_items_order ON public.order_crossell_items(order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_crossell_items TO authenticated;
GRANT ALL ON public.order_crossell_items TO service_role;

ALTER TABLE public.order_crossell_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read crossell items"
  ON public.order_crossell_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated manage crossell items"
  ON public.order_crossell_items FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- 3) Allow an event to be run without crossell
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS crossell_enabled boolean NOT NULL DEFAULT false;

-- 4) updated_at trigger for offers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_event_crossell_offers_updated_at
  BEFORE UPDATE ON public.event_crossell_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Realtime for crossell items (reflect on the event order card)
ALTER TABLE public.order_crossell_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_crossell_items;