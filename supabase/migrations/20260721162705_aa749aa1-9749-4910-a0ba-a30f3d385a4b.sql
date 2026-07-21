
-- 1. Colunas de vínculo
ALTER TABLE public.product_master_data
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_id    UUID REFERENCES public.product_brands(id)     ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pmd_category_id ON public.product_master_data(category_id);
CREATE INDEX IF NOT EXISTS idx_pmd_brand_id    ON public.product_master_data(brand_id);

-- 2. Helper de normalização (case + accent insensitive)
CREATE OR REPLACE FUNCTION public.norm_txt(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(translate(coalesce(t,''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
$$;

-- 3. Backfill inicial dos IDs a partir dos nomes de texto
UPDATE public.product_master_data p
SET category_id = c.id
FROM public.product_categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND public.norm_txt(p.category) = public.norm_txt(c.name);

UPDATE public.product_master_data p
SET brand_id = b.id
FROM public.product_brands b
WHERE p.brand_id IS NULL
  AND p.brand IS NOT NULL
  AND public.norm_txt(p.brand) = public.norm_txt(b.name);

-- 4. Trigger sincronizador (texto <-> id)
CREATE OR REPLACE FUNCTION public.sync_product_category_brand()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  -- CATEGORY
  IF TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.category IS DISTINCT FROM OLD.category THEN
    IF NEW.category_id IS NOT NULL
       AND (TG_OP='INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id) THEN
      SELECT name INTO v_name FROM public.product_categories WHERE id = NEW.category_id;
      IF v_name IS NOT NULL THEN NEW.category := v_name; END IF;
    ELSIF NEW.category IS NOT NULL
          AND (TG_OP='INSERT' OR NEW.category IS DISTINCT FROM OLD.category)
          AND (NEW.category_id IS NULL OR NEW.category_id = COALESCE(OLD.category_id, NEW.category_id)) THEN
      SELECT id INTO v_id FROM public.product_categories
        WHERE public.norm_txt(name) = public.norm_txt(NEW.category) LIMIT 1;
      NEW.category_id := v_id;
    END IF;
  END IF;

  -- BRAND
  IF TG_OP = 'INSERT' OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
     OR NEW.brand IS DISTINCT FROM OLD.brand THEN
    IF NEW.brand_id IS NOT NULL
       AND (TG_OP='INSERT' OR NEW.brand_id IS DISTINCT FROM OLD.brand_id) THEN
      SELECT name INTO v_name FROM public.product_brands WHERE id = NEW.brand_id;
      IF v_name IS NOT NULL THEN NEW.brand := v_name; END IF;
    ELSIF NEW.brand IS NOT NULL
          AND (TG_OP='INSERT' OR NEW.brand IS DISTINCT FROM OLD.brand)
          AND (NEW.brand_id IS NULL OR NEW.brand_id = COALESCE(OLD.brand_id, NEW.brand_id)) THEN
      SELECT id INTO v_id FROM public.product_brands
        WHERE public.norm_txt(name) = public.norm_txt(NEW.brand) LIMIT 1;
      NEW.brand_id := v_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_product_category_brand ON public.product_master_data;
CREATE TRIGGER trg_sync_product_category_brand
  BEFORE INSERT OR UPDATE OF category, category_id, brand, brand_id
  ON public.product_master_data
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_category_brand();

-- 5. RPCs de contagem
CREATE OR REPLACE FUNCTION public.count_products_by_category()
RETURNS TABLE(category_id uuid, total bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT category_id, count(*)::bigint
  FROM public.product_master_data
  WHERE category_id IS NOT NULL AND is_active = true
  GROUP BY category_id;
$$;

CREATE OR REPLACE FUNCTION public.count_products_by_brand()
RETURNS TABLE(brand_id uuid, total bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT brand_id, count(*)::bigint
  FROM public.product_master_data
  WHERE brand_id IS NOT NULL AND is_active = true
  GROUP BY brand_id;
$$;

-- 6. Transferência em massa entre marcas
CREATE OR REPLACE FUNCTION public.transfer_products_brand(p_from uuid, p_to uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'from/to brand inválidos';
  END IF;
  UPDATE public.product_master_data
    SET brand_id = p_to
    WHERE brand_id = p_from;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Transferência em massa entre categorias (bônus, mesma UX)
CREATE OR REPLACE FUNCTION public.transfer_products_category(p_from uuid, p_to uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'from/to category inválidos';
  END IF;
  UPDATE public.product_master_data
    SET category_id = p_to
    WHERE category_id = p_from;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.count_products_by_category() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_products_by_brand() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_products_brand(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_products_category(uuid, uuid) TO authenticated;
