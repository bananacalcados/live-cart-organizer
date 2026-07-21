
-- ============================================================
-- ETAPA 1: espelhamento bidirecional Legacy <-> Catálogo Unificado
-- products_master (Legacy)  <-->  product_master_data (Unificado)
-- Chave: products_master.sku_root = product_master_data.parent_sku
-- ============================================================

-- Helper anti-loop: reaproveita a mesma flag usada por sync_master_to_pos
-- e sync_pos_product_to_estoque, com fallback caso a função não exista.
CREATE OR REPLACE FUNCTION public._pm_pmd_sync_in_progress()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN coalesce(current_setting('app.pm_pmd_sync', true), 'off') = 'on';
END;
$$;

-- ------------------------------------------------------------
-- Legacy -> Unificado (INSERT/UPDATE)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_master_to_pmd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public._pm_pmd_sync_in_progress() THEN RETURN NEW; END IF;
  PERFORM set_config('app.pm_pmd_sync', 'on', true);

  INSERT INTO product_master_data (
    parent_sku, name, description, brand, brand_id, category, category_id,
    ncm, cest, origem, unidade,
    cost_price, sale_price,
    weight_kg, height_cm, width_cm, length_cm,
    images, shopify_product_id, tiny_product_id,
    is_active, needs_review, review_reason,
    updated_at
  )
  VALUES (
    NEW.sku_root, NEW.name, NEW.description, NEW.brand, NEW.brand_id, NEW.category, NEW.category_id,
    NEW.ncm, NEW.cest, NEW.origem, NEW.unidade,
    NEW.cost_price, NEW.sale_price,
    NEW.weight_kg, NEW.height_cm, NEW.width_cm, NEW.length_cm,
    NEW.images, NEW.shopify_product_id, NEW.tiny_product_id,
    NEW.is_active, NEW.needs_review, NEW.review_reason,
    now()
  )
  ON CONFLICT (parent_sku) DO UPDATE SET
    name               = EXCLUDED.name,
    description        = EXCLUDED.description,
    brand              = EXCLUDED.brand,
    brand_id           = EXCLUDED.brand_id,
    category           = EXCLUDED.category,
    category_id        = EXCLUDED.category_id,
    ncm                = EXCLUDED.ncm,
    cest               = EXCLUDED.cest,
    origem             = EXCLUDED.origem,
    unidade            = EXCLUDED.unidade,
    cost_price         = EXCLUDED.cost_price,
    sale_price         = EXCLUDED.sale_price,
    weight_kg          = EXCLUDED.weight_kg,
    height_cm          = EXCLUDED.height_cm,
    width_cm           = EXCLUDED.width_cm,
    length_cm          = EXCLUDED.length_cm,
    images             = EXCLUDED.images,
    shopify_product_id = EXCLUDED.shopify_product_id,
    tiny_product_id    = EXCLUDED.tiny_product_id,
    is_active          = EXCLUDED.is_active,
    needs_review       = EXCLUDED.needs_review,
    review_reason      = EXCLUDED.review_reason,
    updated_at         = now();

  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RAISE WARNING 'sync_master_to_pmd falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- Legacy -> Unificado (DELETE)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_master_to_pmd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public._pm_pmd_sync_in_progress() THEN RETURN OLD; END IF;
  PERFORM set_config('app.pm_pmd_sync', 'on', true);

  DELETE FROM product_master_data WHERE parent_sku = OLD.sku_root;

  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RAISE WARNING 'delete_master_to_pmd falhou: %', SQLERRM;
  RETURN OLD;
END;
$$;

-- ------------------------------------------------------------
-- Unificado -> Legacy (INSERT/UPDATE)
-- Se não existir o pai no Legacy, cria (com sku_root = parent_sku).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_pmd_to_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public._pm_pmd_sync_in_progress() THEN RETURN NEW; END IF;
  PERFORM set_config('app.pm_pmd_sync', 'on', true);

  IF EXISTS (SELECT 1 FROM products_master WHERE sku_root = NEW.parent_sku) THEN
    UPDATE products_master SET
      name               = NEW.name,
      description        = NEW.description,
      brand              = NEW.brand,
      brand_id           = NEW.brand_id,
      category           = NEW.category,
      category_id        = NEW.category_id,
      ncm                = coalesce(NEW.ncm, ncm),
      cest               = NEW.cest,
      origem             = coalesce(NEW.origem, origem),
      unidade            = coalesce(NEW.unidade, unidade),
      cost_price         = coalesce(NEW.cost_price, cost_price),
      sale_price         = coalesce(NEW.sale_price, sale_price),
      weight_kg          = NEW.weight_kg,
      height_cm          = NEW.height_cm,
      width_cm           = NEW.width_cm,
      length_cm          = NEW.length_cm,
      images             = coalesce(NEW.images, images),
      shopify_product_id = NEW.shopify_product_id,
      tiny_product_id    = NEW.tiny_product_id,
      is_active          = NEW.is_active,
      needs_review       = NEW.needs_review,
      review_reason      = NEW.review_reason,
      updated_at         = now()
    WHERE sku_root = NEW.parent_sku;
  ELSE
    INSERT INTO products_master (
      sku_root, name, description, brand, brand_id, category, category_id,
      ncm, cest, origem, unidade,
      cost_price, sale_price,
      weight_kg, height_cm, width_cm, length_cm,
      images, shopify_product_id, tiny_product_id,
      is_active, needs_review, review_reason
    ) VALUES (
      NEW.parent_sku, NEW.name, NEW.description, NEW.brand, NEW.brand_id, NEW.category, NEW.category_id,
      coalesce(NEW.ncm, '64039900'), NEW.cest, coalesce(NEW.origem, '0'), coalesce(NEW.unidade, 'UN'),
      coalesce(NEW.cost_price, 0), coalesce(NEW.sale_price, 0),
      NEW.weight_kg, NEW.height_cm, NEW.width_cm, NEW.length_cm,
      coalesce(NEW.images, ARRAY[]::text[]), NEW.shopify_product_id, NEW.tiny_product_id,
      coalesce(NEW.is_active, true), coalesce(NEW.needs_review, false), NEW.review_reason
    )
    ON CONFLICT (sku_root) DO NOTHING;
  END IF;

  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RAISE WARNING 'sync_pmd_to_master falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- Unificado -> Legacy (DELETE)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_pmd_to_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public._pm_pmd_sync_in_progress() THEN RETURN OLD; END IF;
  PERFORM set_config('app.pm_pmd_sync', 'on', true);

  DELETE FROM products_master WHERE sku_root = OLD.parent_sku;

  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.pm_pmd_sync', 'off', true);
  RAISE WARNING 'delete_pmd_to_master falhou: %', SQLERRM;
  RETURN OLD;
END;
$$;

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_master_to_pmd     ON public.products_master;
DROP TRIGGER IF EXISTS trg_delete_master_to_pmd   ON public.products_master;
DROP TRIGGER IF EXISTS trg_sync_pmd_to_master     ON public.product_master_data;
DROP TRIGGER IF EXISTS trg_delete_pmd_to_master   ON public.product_master_data;

CREATE TRIGGER trg_sync_master_to_pmd
AFTER INSERT OR UPDATE ON public.products_master
FOR EACH ROW EXECUTE FUNCTION public.sync_master_to_pmd();

CREATE TRIGGER trg_delete_master_to_pmd
AFTER DELETE ON public.products_master
FOR EACH ROW EXECUTE FUNCTION public.delete_master_to_pmd();

CREATE TRIGGER trg_sync_pmd_to_master
AFTER INSERT OR UPDATE ON public.product_master_data
FOR EACH ROW EXECUTE FUNCTION public.sync_pmd_to_master();

CREATE TRIGGER trg_delete_pmd_to_master
AFTER DELETE ON public.product_master_data
FOR EACH ROW EXECUTE FUNCTION public.delete_pmd_to_master();

-- ------------------------------------------------------------
-- BACKFILL: Legacy vence.
-- 1) Remove órfãos do Unificado (não existem no Legacy)
-- 2) Alinha cabeçalhos existentes com os valores do Legacy
-- ------------------------------------------------------------
SELECT set_config('app.pm_pmd_sync', 'on', true);

DELETE FROM product_master_data pmd
WHERE NOT EXISTS (
  SELECT 1 FROM products_master pm WHERE pm.sku_root = pmd.parent_sku
);

UPDATE product_master_data pmd SET
  name               = pm.name,
  description        = pm.description,
  brand              = pm.brand,
  brand_id           = pm.brand_id,
  category           = pm.category,
  category_id        = pm.category_id,
  ncm                = pm.ncm,
  cest               = pm.cest,
  origem             = pm.origem,
  unidade            = pm.unidade,
  cost_price         = pm.cost_price,
  sale_price         = pm.sale_price,
  weight_kg          = pm.weight_kg,
  height_cm          = pm.height_cm,
  width_cm           = pm.width_cm,
  length_cm          = pm.length_cm,
  images             = pm.images,
  shopify_product_id = pm.shopify_product_id,
  tiny_product_id    = pm.tiny_product_id,
  is_active          = pm.is_active,
  needs_review       = pm.needs_review,
  review_reason      = pm.review_reason,
  updated_at         = now()
FROM products_master pm
WHERE pm.sku_root = pmd.parent_sku;

-- Cria no Unificado qualquer pai que só exista no Legacy
INSERT INTO product_master_data (
  parent_sku, name, description, brand, brand_id, category, category_id,
  ncm, cest, origem, unidade,
  cost_price, sale_price,
  weight_kg, height_cm, width_cm, length_cm,
  images, shopify_product_id, tiny_product_id,
  is_active, needs_review, review_reason
)
SELECT
  pm.sku_root, pm.name, pm.description, pm.brand, pm.brand_id, pm.category, pm.category_id,
  pm.ncm, pm.cest, pm.origem, pm.unidade,
  pm.cost_price, pm.sale_price,
  pm.weight_kg, pm.height_cm, pm.width_cm, pm.length_cm,
  pm.images, pm.shopify_product_id, pm.tiny_product_id,
  pm.is_active, pm.needs_review, pm.review_reason
FROM products_master pm
WHERE NOT EXISTS (
  SELECT 1 FROM product_master_data pmd WHERE pmd.parent_sku = pm.sku_root
);

SELECT set_config('app.pm_pmd_sync', 'off', true);
