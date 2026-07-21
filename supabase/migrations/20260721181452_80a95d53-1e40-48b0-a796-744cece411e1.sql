
-- Auto-create brands and categories when a product is inserted/updated with a new brand/category name.
-- Also auto-links brand_id / category_id whenever the text matches an existing row (case-insensitive).
CREATE OR REPLACE FUNCTION public.auto_link_product_brand_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id uuid;
  v_cat_id uuid;
  v_slug text;
BEGIN
  -- BRAND
  IF NEW.brand IS NOT NULL AND btrim(NEW.brand) <> '' THEN
    SELECT id INTO v_brand_id
    FROM public.product_brands
    WHERE lower(name) = lower(btrim(NEW.brand))
    LIMIT 1;

    IF v_brand_id IS NULL THEN
      v_slug := regexp_replace(regexp_replace(lower(btrim(NEW.brand)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g');
      IF v_slug = '' THEN v_slug := 'marca-' || substr(md5(NEW.brand), 1, 8); END IF;
      -- Garante unicidade do slug
      WHILE EXISTS (SELECT 1 FROM public.product_brands WHERE slug = v_slug) LOOP
        v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
      END LOOP;
      INSERT INTO public.product_brands (name, slug, is_active)
      VALUES (btrim(NEW.brand), v_slug, true)
      RETURNING id INTO v_brand_id;
    END IF;

    NEW.brand_id := v_brand_id;
    NEW.brand := btrim(NEW.brand);
  ELSE
    NEW.brand_id := NULL;
  END IF;

  -- CATEGORY
  IF NEW.category IS NOT NULL AND btrim(NEW.category) <> '' THEN
    -- Se já veio com category_id válido e nome bate, mantém.
    IF NEW.category_id IS NOT NULL THEN
      SELECT id INTO v_cat_id FROM public.product_categories WHERE id = NEW.category_id LIMIT 1;
    END IF;

    IF v_cat_id IS NULL THEN
      SELECT id INTO v_cat_id
      FROM public.product_categories
      WHERE lower(name) = lower(btrim(NEW.category))
      LIMIT 1;
    END IF;

    IF v_cat_id IS NULL THEN
      v_slug := regexp_replace(regexp_replace(lower(btrim(NEW.category)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g');
      IF v_slug = '' THEN v_slug := 'cat-' || substr(md5(NEW.category), 1, 8); END IF;
      WHILE EXISTS (SELECT 1 FROM public.product_categories WHERE slug = v_slug) LOOP
        v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
      END LOOP;
      INSERT INTO public.product_categories (name, slug, is_active, priority)
      VALUES (btrim(NEW.category), v_slug, true, 0)
      RETURNING id INTO v_cat_id;
    END IF;

    NEW.category_id := v_cat_id;
    NEW.category := btrim(NEW.category);
  ELSE
    NEW.category_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_brand_category_pm ON public.products_master;
CREATE TRIGGER trg_auto_link_brand_category_pm
BEFORE INSERT OR UPDATE OF brand, category, brand_id, category_id
ON public.products_master
FOR EACH ROW EXECUTE FUNCTION public.auto_link_product_brand_category();

DROP TRIGGER IF EXISTS trg_auto_link_brand_category_pmd ON public.product_master_data;
CREATE TRIGGER trg_auto_link_brand_category_pmd
BEFORE INSERT OR UPDATE OF brand, category, brand_id, category_id
ON public.product_master_data
FOR EACH ROW EXECUTE FUNCTION public.auto_link_product_brand_category();

-- Backfill: cria marcas/categorias faltantes a partir dos produtos já existentes
-- e vincula brand_id/category_id onde estiverem nulos.
INSERT INTO public.product_brands (name, slug, is_active)
SELECT DISTINCT btrim(p.brand),
       regexp_replace(regexp_replace(lower(btrim(p.brand)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'),
       true
FROM (
  SELECT brand FROM public.products_master WHERE brand IS NOT NULL AND btrim(brand) <> ''
  UNION
  SELECT brand FROM public.product_master_data WHERE brand IS NOT NULL AND btrim(brand) <> ''
) p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_brands b WHERE lower(b.name) = lower(btrim(p.brand))
)
ON CONFLICT DO NOTHING;

INSERT INTO public.product_categories (name, slug, is_active, priority)
SELECT DISTINCT btrim(p.category),
       regexp_replace(regexp_replace(lower(btrim(p.category)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'),
       true,
       0
FROM (
  SELECT category FROM public.products_master WHERE category IS NOT NULL AND btrim(category) <> ''
  UNION
  SELECT category FROM public.product_master_data WHERE category IS NOT NULL AND btrim(category) <> ''
) p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_categories c WHERE lower(c.name) = lower(btrim(p.category))
)
ON CONFLICT DO NOTHING;

-- Relink IDs onde estão nulos
UPDATE public.products_master pm
SET brand_id = b.id
FROM public.product_brands b
WHERE pm.brand_id IS NULL
  AND pm.brand IS NOT NULL
  AND lower(btrim(pm.brand)) = lower(b.name);

UPDATE public.products_master pm
SET category_id = c.id
FROM public.product_categories c
WHERE pm.category_id IS NULL
  AND pm.category IS NOT NULL
  AND lower(btrim(pm.category)) = lower(c.name);

UPDATE public.product_master_data pmd
SET brand_id = b.id
FROM public.product_brands b
WHERE pmd.brand_id IS NULL
  AND pmd.brand IS NOT NULL
  AND lower(btrim(pmd.brand)) = lower(b.name);

UPDATE public.product_master_data pmd
SET category_id = c.id
FROM public.product_categories c
WHERE pmd.category_id IS NULL
  AND pmd.category IS NOT NULL
  AND lower(btrim(pmd.category)) = lower(c.name);
