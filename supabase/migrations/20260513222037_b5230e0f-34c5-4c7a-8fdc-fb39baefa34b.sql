
-- ============================================================
-- Etapa A1: Unificação em pos_products + product_master_data
-- ============================================================

-- 1) Tabela complementar de metadados de catálogo/fiscal por modelo-pai
CREATE TABLE IF NOT EXISTS public.product_master_data (
  parent_sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  category TEXT,
  classe_produto TEXT,
  ncm TEXT,
  cest TEXT,
  cfop TEXT,
  origem TEXT,
  unidade TEXT DEFAULT 'PAR',
  cost_price NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  markup NUMERIC(8,4),
  weight_kg NUMERIC(8,3),
  height_cm NUMERIC(8,2),
  width_cm NUMERIC(8,2),
  length_cm NUMERIC(8,2),
  images TEXT[] DEFAULT '{}',
  shopify_product_id TEXT,
  tiny_product_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  needs_review BOOLEAN DEFAULT false,
  review_reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmd_ncm ON public.product_master_data(ncm);
CREATE INDEX IF NOT EXISTS idx_pmd_active ON public.product_master_data(is_active) WHERE is_active;

ALTER TABLE public.product_master_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read pmd" ON public.product_master_data
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write pmd" ON public.product_master_data
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service all pmd" ON public.product_master_data
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public._set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_pmd_updated ON public.product_master_data;
CREATE TRIGGER trg_pmd_updated BEFORE UPDATE ON public.product_master_data
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- 2) Coluna parent_sku em pos_products
ALTER TABLE public.pos_products
  ADD COLUMN IF NOT EXISTS parent_sku TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_products_parent_sku ON public.pos_products(parent_sku);

-- 3) Tabela de movimentações de estoque (idempotência da A5)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_product_id UUID REFERENCES public.pos_products(id) ON DELETE SET NULL,
  store_id UUID,
  sku TEXT,
  barcode TEXT,
  parent_sku TEXT,
  movement_type TEXT NOT NULL, -- 'sale_pos','sale_online','sale_live','nfe_in','nfe_out','adjustment','transfer_in','transfer_out','return'
  quantity NUMERIC(12,3) NOT NULL, -- positivo entra, negativo sai
  reference_type TEXT,             -- 'pos_sale','order','nfe_doc','adjustment',...
  reference_id TEXT,               -- id externo / chave
  idempotency_key TEXT UNIQUE,     -- ex: 'order:<uuid>:sku:<SKU>' ou 'nfe:<chave>:item:<n>'
  unit_cost NUMERIC(12,2),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sm_store ON public.stock_movements(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_sku ON public.stock_movements(sku);
CREATE INDEX IF NOT EXISTS idx_sm_parent ON public.stock_movements(parent_sku);
CREATE INDEX IF NOT EXISTS idx_sm_ref ON public.stock_movements(reference_type, reference_id);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sm" ON public.stock_movements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert sm" ON public.stock_movements
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "service all sm" ON public.stock_movements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4) Backfill product_master_data a partir de products_master
INSERT INTO public.product_master_data (
  parent_sku, name, description, brand, category, classe_produto,
  ncm, cest, origem, unidade, cost_price, sale_price,
  weight_kg, height_cm, width_cm, length_cm, images,
  shopify_product_id, tiny_product_id, is_active, needs_review, review_reason,
  created_by, created_at, updated_at
)
SELECT
  COALESCE(NULLIF(TRIM(sku_root),''), 'PMSTR-' || id::text) AS parent_sku,
  COALESCE(name, 'Sem nome'),
  description, brand, category, classe_produto,
  ncm, cest, origem, COALESCE(unidade,'PAR'),
  cost_price, sale_price,
  weight_kg, height_cm, width_cm, length_cm,
  COALESCE(images, '{}'),
  shopify_product_id, tiny_product_id,
  COALESCE(is_active, true), needs_review, review_reason,
  created_by, created_at, updated_at
FROM public.products_master
ON CONFLICT (parent_sku) DO NOTHING;

-- 5) Backfill pos_products.parent_sku via match em product_variants (gtin == barcode OU sku == sku)
UPDATE public.pos_products p
SET parent_sku = pm.sku_root
FROM public.product_variants pv
JOIN public.products_master pm ON pm.id = pv.master_id
WHERE p.parent_sku IS NULL
  AND pm.sku_root IS NOT NULL
  AND (
    (p.barcode IS NOT NULL AND p.barcode = pv.gtin)
    OR (p.sku IS NOT NULL AND p.sku = pv.sku)
  );

-- 6) Fallback: parent_sku = sku para órfãos (e parent_sku = barcode se não houver sku)
UPDATE public.pos_products
SET parent_sku = COALESCE(NULLIF(TRIM(sku),''), NULLIF(TRIM(barcode),''), 'POS-' || id::text)
WHERE parent_sku IS NULL;

-- 7) View de auditoria de órfãos (SKUs do PDV sem master_data correspondente)
CREATE OR REPLACE VIEW public.v_a1_orphan_pos_products AS
SELECT
  p.id, p.store_id, p.sku, p.barcode, p.name, p.parent_sku,
  CASE
    WHEN pmd.parent_sku IS NULL THEN 'sem_master_data'
    ELSE 'ok'
  END AS status
FROM public.pos_products p
LEFT JOIN public.product_master_data pmd ON pmd.parent_sku = p.parent_sku
WHERE pmd.parent_sku IS NULL;

CREATE OR REPLACE VIEW public.v_a1_backfill_summary AS
SELECT
  (SELECT COUNT(*) FROM public.product_master_data) AS total_master_data,
  (SELECT COUNT(*) FROM public.pos_products) AS total_pos_products,
  (SELECT COUNT(*) FROM public.pos_products WHERE parent_sku IS NOT NULL) AS pos_with_parent,
  (SELECT COUNT(*) FROM public.v_a1_orphan_pos_products) AS pos_orphans,
  (SELECT COUNT(DISTINCT parent_sku) FROM public.pos_products) AS distinct_parents_in_pos;
