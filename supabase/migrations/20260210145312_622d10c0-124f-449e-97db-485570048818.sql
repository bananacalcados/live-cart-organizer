
-- Table for tiered pricing promotions (per event)
CREATE TABLE public.event_promotions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Can be linked to shopify collection handle or specific product IDs
  shopify_collection_handle text,
  shopify_product_ids text[], -- Array of Shopify product GIDs
  -- Tiered pricing rules as JSON array: [{quantity: 1, price: 150}, {quantity: 2, price: 240}]
  tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.event_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to event_promotions" ON public.event_promotions FOR ALL USING (true) WITH CHECK (true);

-- Table for fast payment tracking (paid within 10 min = eligible for prize wheel)
ALTER TABLE public.orders ADD COLUMN checkout_started_at timestamp with time zone DEFAULT NULL;
ALTER TABLE public.orders ADD COLUMN eligible_for_prize boolean DEFAULT false;
