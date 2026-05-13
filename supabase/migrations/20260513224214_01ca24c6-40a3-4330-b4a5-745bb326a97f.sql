-- =========================================================
-- A2.1 — Marcar órfãos para revisão manual + flag + RPC
-- =========================================================

-- 1) Garantir que defaults estejam corretos e marcar tudo que falta dado fiscal
--    Reasons concatenados (separados por "; ")
WITH calc AS (
  SELECT
    parent_sku,
    NULLIF(
      ARRAY_TO_STRING(ARRAY_REMOVE(ARRAY[
        CASE WHEN ncm IS NULL OR LENGTH(TRIM(ncm)) < 8 THEN 'NCM ausente/inválido' END,
        CASE WHEN cfop IS NULL OR LENGTH(TRIM(cfop)) < 4 THEN 'CFOP ausente' END,
        CASE WHEN cost_price IS NULL OR cost_price <= 0 THEN 'Custo ausente' END,
        CASE WHEN sale_price IS NULL OR sale_price <= 0 THEN 'Preço de venda ausente' END,
        CASE WHEN images IS NULL OR cardinality(images) = 0 THEN 'Sem imagens' END,
        CASE WHEN name IS NULL OR LENGTH(TRIM(name)) = 0 THEN 'Nome ausente' END
      ], NULL), '; '),
    '') AS reason
  FROM product_master_data
)
UPDATE product_master_data pmd
SET
  needs_review = (calc.reason IS NOT NULL),
  review_reason = calc.reason,
  updated_at = now()
FROM calc
WHERE pmd.parent_sku = calc.parent_sku
  AND ( COALESCE(pmd.needs_review, false) <> (calc.reason IS NOT NULL)
        OR COALESCE(pmd.review_reason, '') <> COALESCE(calc.reason, '') );

-- 2) Feature flag global em system_settings
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sys_settings_read ON public.system_settings;
CREATE POLICY sys_settings_read ON public.system_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sys_settings_write ON public.system_settings;
CREATE POLICY sys_settings_write ON public.system_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'use_unified_inventory',
  jsonb_build_object('enabled', false),
  'Quando true, NF-e de entrada e criação de produtos gravam em product_master_data + pos_products como fonte de verdade.'
)
ON CONFLICT (key) DO NOTHING;

-- 3) Helper: ler flag
CREATE OR REPLACE FUNCTION public.is_unified_inventory_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((value->>'enabled')::boolean, false)
  FROM public.system_settings
  WHERE key = 'use_unified_inventory'
$$;

-- 4) RPC atômica para entrada de NF-e em pos_products + product_master_data
--    Idempotência via stock_movements.idempotency_key (UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_movements_idem_key
  ON public.stock_movements (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.unified_inventory_apply_nfe_entry(
  p_parent_sku text,
  p_master jsonb,    -- { name, ncm, cfop, cest, origem, unidade, cost_price, brand, category, classe_produto }
  p_store_id uuid,
  p_sku text,
  p_barcode text,
  p_color text,
  p_size text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_invoice_id uuid,
  p_invoice_item_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pos_id uuid;
  v_idem_key text;
  v_existing_mov_id uuid;
  v_name text;
BEGIN
  IF p_parent_sku IS NULL OR LENGTH(TRIM(p_parent_sku)) = 0 THEN
    RAISE EXCEPTION 'parent_sku é obrigatório';
  END IF;
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id é obrigatório';
  END IF;

  v_idem_key := 'nfe-entry:' || p_invoice_item_id::text || ':' || p_store_id::text;

  -- Idempotência: se já processou, retorna sem reaplicar
  SELECT id INTO v_existing_mov_id
  FROM public.stock_movements
  WHERE idempotency_key = v_idem_key
  LIMIT 1;
  IF v_existing_mov_id IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_applied', 'movement_id', v_existing_mov_id);
  END IF;

  v_name := COALESCE(NULLIF(TRIM(p_master->>'name'), ''), p_parent_sku);

  -- Upsert product_master_data
  INSERT INTO public.product_master_data (
    parent_sku, name, ncm, cfop, cest, origem, unidade,
    cost_price, brand, category, classe_produto, is_active
  )
  VALUES (
    p_parent_sku, v_name,
    NULLIF(p_master->>'ncm',''), NULLIF(p_master->>'cfop',''), NULLIF(p_master->>'cest',''),
    NULLIF(p_master->>'origem',''), COALESCE(NULLIF(p_master->>'unidade',''), 'PC'),
    NULLIF(p_master->>'cost_price','')::numeric,
    NULLIF(p_master->>'brand',''), NULLIF(p_master->>'category',''),
    NULLIF(p_master->>'classe_produto',''), true
  )
  ON CONFLICT (parent_sku) DO UPDATE SET
    name          = COALESCE(EXCLUDED.name, product_master_data.name),
    ncm           = COALESCE(EXCLUDED.ncm, product_master_data.ncm),
    cfop          = COALESCE(EXCLUDED.cfop, product_master_data.cfop),
    cest          = COALESCE(EXCLUDED.cest, product_master_data.cest),
    origem        = COALESCE(EXCLUDED.origem, product_master_data.origem),
    unidade       = COALESCE(EXCLUDED.unidade, product_master_data.unidade),
    cost_price    = COALESCE(EXCLUDED.cost_price, product_master_data.cost_price),
    brand         = COALESCE(EXCLUDED.brand, product_master_data.brand),
    category      = COALESCE(EXCLUDED.category, product_master_data.category),
    classe_produto= COALESCE(EXCLUDED.classe_produto, product_master_data.classe_produto),
    updated_at    = now();

  -- Re-marcar review (caso ainda falte algo)
  UPDATE public.product_master_data
  SET needs_review = (
        ncm IS NULL OR LENGTH(TRIM(ncm)) < 8
        OR cost_price IS NULL OR cost_price <= 0
      ),
      review_reason = NULLIF(ARRAY_TO_STRING(ARRAY_REMOVE(ARRAY[
        CASE WHEN ncm IS NULL OR LENGTH(TRIM(ncm)) < 8 THEN 'NCM ausente/inválido' END,
        CASE WHEN cost_price IS NULL OR cost_price <= 0 THEN 'Custo ausente' END
      ], NULL), '; '), '')
  WHERE parent_sku = p_parent_sku;

  -- Upsert pos_products (chave: store_id + sku)
  SELECT id INTO v_pos_id
  FROM public.pos_products
  WHERE store_id = p_store_id
    AND ( (p_sku IS NOT NULL AND sku = p_sku)
       OR (p_barcode IS NOT NULL AND barcode = p_barcode) )
  LIMIT 1;

  IF v_pos_id IS NULL THEN
    INSERT INTO public.pos_products (
      store_id, parent_sku, sku, barcode, name,
      cost_price, price, stock, is_active
    )
    VALUES (
      p_store_id, p_parent_sku, p_sku, p_barcode,
      TRIM(v_name || ' ' || COALESCE(p_color,'') || ' ' || COALESCE(p_size,'')),
      p_unit_cost,
      0,                     -- preço de venda fica para edição posterior
      GREATEST(p_quantity, 0),
      true
    )
    RETURNING id INTO v_pos_id;
  ELSE
    UPDATE public.pos_products SET
      parent_sku = COALESCE(parent_sku, p_parent_sku),
      barcode    = COALESCE(barcode, p_barcode),
      cost_price = COALESCE(p_unit_cost, cost_price),
      stock      = COALESCE(stock, 0) + COALESCE(p_quantity, 0),
      is_active  = true,
      updated_at = now()
    WHERE id = v_pos_id;
  END IF;

  -- Registrar movimento (idempotente)
  INSERT INTO public.stock_movements (
    pos_product_id, store_id, sku, barcode, parent_sku,
    movement_type, quantity, reference_type, reference_id,
    idempotency_key, unit_cost, notes
  )
  VALUES (
    v_pos_id, p_store_id, p_sku, p_barcode, p_parent_sku,
    'nfe_entry', p_quantity, 'purchase_invoice', p_invoice_id,
    v_idem_key, p_unit_cost,
    'Entrada via NF-e item ' || p_invoice_item_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'pos_product_id', v_pos_id,
    'parent_sku', p_parent_sku,
    'quantity_added', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unified_inventory_apply_nfe_entry(
  text, jsonb, uuid, text, text, text, text, numeric, numeric, uuid, uuid
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_unified_inventory_enabled() TO authenticated, anon, service_role;

-- 5) View de conveniência: produtos pendentes de revisão
CREATE OR REPLACE VIEW public.v_products_needs_review AS
SELECT
  pmd.parent_sku,
  pmd.name,
  pmd.brand,
  pmd.category,
  pmd.ncm,
  pmd.cfop,
  pmd.cest,
  pmd.cost_price,
  pmd.sale_price,
  pmd.review_reason,
  pmd.updated_at,
  COUNT(pp.id) FILTER (WHERE pp.is_active) AS sku_count,
  COALESCE(SUM(pp.stock), 0) AS total_stock
FROM public.product_master_data pmd
LEFT JOIN public.pos_products pp ON pp.parent_sku = pmd.parent_sku
WHERE pmd.needs_review = true AND pmd.is_active = true
GROUP BY pmd.parent_sku, pmd.name, pmd.brand, pmd.category, pmd.ncm,
         pmd.cfop, pmd.cest, pmd.cost_price, pmd.sale_price,
         pmd.review_reason, pmd.updated_at
ORDER BY pmd.updated_at DESC;