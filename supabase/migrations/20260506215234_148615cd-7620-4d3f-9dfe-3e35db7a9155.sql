
-- 5.1 products_master additions
ALTER TABLE public.products_master
  ADD COLUMN IF NOT EXISTS tiny_product_id BIGINT,
  ADD COLUMN IF NOT EXISTS classe_produto TEXT,
  ADD COLUMN IF NOT EXISTS tiny_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tiny_source_store_id UUID REFERENCES public.pos_stores(id),
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- 5.2 product_variants additions
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS tiny_variant_id BIGINT,
  ADD COLUMN IF NOT EXISTS tiny_imported_at TIMESTAMPTZ;

-- 5.3 product_dedup_index
CREATE TABLE IF NOT EXISTS public.product_dedup_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL,
  dedupe_method TEXT NOT NULL CHECK (dedupe_method IN ('gtin','fallback_name_sku')),
  representative_pos_product_id UUID REFERENCES public.pos_products(id) ON DELETE SET NULL,
  representative_name TEXT,
  representative_category TEXT,
  stores_present UUID[] NOT NULL DEFAULT '{}',
  tiny_ids_per_store JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ,
  validation_status TEXT CHECK (validation_status IN ('pending','consistent','divergent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dedupe_key, dedupe_method)
);

-- 5.4 tiny_import_runs
CREATE TABLE IF NOT EXISTS public.tiny_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('discovery','import','cross_validation')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total_processed INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  dry_run BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID
);

-- 5.5 tiny_import_errors
CREATE TABLE IF NOT EXISTS public.tiny_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.tiny_import_runs(id) ON DELETE CASCADE,
  dedup_index_id UUID REFERENCES public.product_dedup_index(id) ON DELETE CASCADE,
  error_code TEXT,
  error_message TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.6 tiny_fiscal_divergences
CREATE TABLE IF NOT EXISTS public.tiny_fiscal_divergences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_index_id UUID REFERENCES public.product_dedup_index(id) ON DELETE CASCADE,
  store_a_id UUID REFERENCES public.pos_stores(id),
  store_b_id UUID REFERENCES public.pos_stores(id),
  field_name TEXT NOT NULL,
  value_a TEXT,
  value_b TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_value TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.7 Indexes
CREATE INDEX IF NOT EXISTS idx_dedup_pending_import ON public.product_dedup_index(imported_at) WHERE imported_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dedup_key ON public.product_dedup_index(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_pm_tiny_product_id ON public.products_master(tiny_product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_tiny_variant_id ON public.product_variants(tiny_variant_id) WHERE tiny_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiny_import_errors_run ON public.tiny_import_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_tiny_import_runs_type_started ON public.tiny_import_runs(run_type, started_at DESC);

-- 5.8 RLS
ALTER TABLE public.product_dedup_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_import_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_fiscal_divergences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view dedup index" ON public.product_dedup_index FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view tiny runs" ON public.tiny_import_runs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view tiny errors" ON public.tiny_import_errors FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view divergences" ON public.tiny_fiscal_divergences FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update divergences" ON public.tiny_fiscal_divergences FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update dedup index" ON public.product_dedup_index FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger for dedup_index
CREATE TRIGGER trg_dedup_index_updated_at BEFORE UPDATE ON public.product_dedup_index
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
