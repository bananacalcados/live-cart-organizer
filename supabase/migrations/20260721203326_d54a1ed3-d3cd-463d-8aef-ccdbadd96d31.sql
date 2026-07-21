
CREATE TABLE public.inventory_health_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NULL,
  horizon_days INTEGER NOT NULL,
  payload JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inventory_health_cache_key
  ON public.inventory_health_cache (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), horizon_days);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_health_cache TO authenticated;
GRANT ALL ON public.inventory_health_cache TO service_role;

ALTER TABLE public.inventory_health_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read health cache"
  ON public.inventory_health_cache FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated write health cache"
  ON public.inventory_health_cache FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
