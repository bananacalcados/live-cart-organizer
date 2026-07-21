
-- 1) brand_id em products_master
ALTER TABLE public.products_master
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.product_brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_master_brand_id ON public.products_master(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_master_category_id ON public.products_master(category_id);

-- 2) Backfill IDs a partir dos nomes existentes (case-insensitive)
UPDATE public.products_master pm
SET brand_id = b.id
FROM public.product_brands b
WHERE pm.brand_id IS NULL
  AND pm.brand IS NOT NULL
  AND lower(trim(pm.brand)) = lower(trim(b.name));

UPDATE public.products_master pm
SET category_id = c.id
FROM public.product_categories c
WHERE pm.category_id IS NULL
  AND pm.category IS NOT NULL
  AND lower(trim(pm.category)) = lower(trim(c.name));

-- 3) Trigger de sync bidirecional texto ↔ id
CREATE OR REPLACE FUNCTION public.trg_sync_products_master_cat_brand()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  -- brand
  IF NEW.brand_id IS DISTINCT FROM COALESCE(OLD.brand_id, NULL) AND NEW.brand_id IS NOT NULL THEN
    SELECT name INTO v_name FROM public.product_brands WHERE id = NEW.brand_id;
    IF v_name IS NOT NULL THEN NEW.brand := v_name; END IF;
  ELSIF NEW.brand IS DISTINCT FROM COALESCE(OLD.brand, NULL) AND NEW.brand IS NOT NULL AND NEW.brand_id IS NULL THEN
    SELECT id INTO NEW.brand_id FROM public.product_brands WHERE lower(trim(name)) = lower(trim(NEW.brand)) LIMIT 1;
  END IF;

  -- category
  IF NEW.category_id IS DISTINCT FROM COALESCE(OLD.category_id, NULL) AND NEW.category_id IS NOT NULL THEN
    SELECT name INTO v_name FROM public.product_categories WHERE id = NEW.category_id;
    IF v_name IS NOT NULL THEN NEW.category := v_name; END IF;
  ELSIF NEW.category IS DISTINCT FROM COALESCE(OLD.category, NULL) AND NEW.category IS NOT NULL AND NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id FROM public.product_categories WHERE lower(trim(name)) = lower(trim(NEW.category)) LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_products_master_cat_brand ON public.products_master;
CREATE TRIGGER trg_sync_products_master_cat_brand
BEFORE INSERT OR UPDATE OF brand, category, brand_id, category_id ON public.products_master
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_products_master_cat_brand();

-- 4) RPCs de contagem — apontar para products_master (Legacy)
CREATE OR REPLACE FUNCTION public.count_products_by_brand()
RETURNS TABLE(brand_id uuid, total bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT brand_id, count(*)::bigint
  FROM public.products_master
  WHERE brand_id IS NOT NULL AND is_active = true
  GROUP BY brand_id;
$$;

CREATE OR REPLACE FUNCTION public.count_products_by_category()
RETURNS TABLE(category_id uuid, total bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT category_id, count(*)::bigint
  FROM public.products_master
  WHERE category_id IS NOT NULL AND is_active = true
  GROUP BY category_id;
$$;

-- 5) Transferências em massa — reescrever para products_master
CREATE OR REPLACE FUNCTION public.transfer_products_brand(p_from uuid, p_to uuid)
RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.products_master SET brand_id = p_to WHERE brand_id = p_from;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_products_category(p_from uuid, p_to uuid)
RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.products_master SET category_id = p_to WHERE category_id = p_from;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
