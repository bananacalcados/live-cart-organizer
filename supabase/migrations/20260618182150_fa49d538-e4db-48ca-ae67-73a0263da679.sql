ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS legacy_orders integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_spent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_first_purchase_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_last_purchase_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.customers_unified(id),
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customers_unified_merged_into ON public.customers_unified(merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_unified_archived ON public.customers_unified(is_archived) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_customers_unified_source_origins ON public.customers_unified USING gin (source_origins);