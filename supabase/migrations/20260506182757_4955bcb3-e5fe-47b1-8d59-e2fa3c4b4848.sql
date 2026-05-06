-- Channel enum for events
DO $$ BEGIN
  CREATE TYPE public.event_channel AS ENUM ('site', 'pos_perola', 'pos_centro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS channel public.event_channel NOT NULL DEFAULT 'site',
  ADD COLUMN IF NOT EXISTS default_store_id uuid;

-- Revenue attribution on pos_sales
DO $$ BEGIN
  CREATE TYPE public.pos_revenue_attribution AS ENUM ('store', 'site_pickup_only');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS revenue_attribution public.pos_revenue_attribution NOT NULL DEFAULT 'store';

CREATE INDEX IF NOT EXISTS idx_pos_sales_revenue_attribution
  ON public.pos_sales (store_id, revenue_attribution, status);

CREATE INDEX IF NOT EXISTS idx_events_channel ON public.events (channel);
