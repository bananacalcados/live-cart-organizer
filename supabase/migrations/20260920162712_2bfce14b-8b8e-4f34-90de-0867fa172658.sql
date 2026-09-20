
ALTER TABLE public.product_master_data ADD COLUMN IF NOT EXISTS gender text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_master_data_gender_chk') THEN
    ALTER TABLE public.product_master_data ADD CONSTRAINT product_master_data_gender_chk
      CHECK (gender IS NULL OR gender IN ('Feminino','Masculino','Unissex','Menino','Menina','Infantil'));
  END IF;
END $$;

UPDATE public.product_master_data d
SET gender = m.gender
FROM public.products_master m
WHERE m.sku_root = d.parent_sku AND m.gender IS NOT NULL AND d.gender IS DISTINCT FROM m.gender;

CREATE OR REPLACE FUNCTION public.sync_master_to_pmd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public._pm_pmd_sync_in_progress() THEN RETURN NEW; END IF;
  PERFORM set_config('app.pm_pmd_sync', 'on', true);

  INSERT INTO product_master_data (
    parent_sku, name, description, brand, brand_id, category, category_id, gender,
    ncm, cest, origem, unidade,
    cost_price, sale_price,
    weight_kg, height_cm, width_cm, length_cm,
    images, shopify_product_id, tiny_product_id,
    is_active, needs_review, review_reason,
    updated_at
  )
  VALUES (
    NEW.sku_root, NEW.name, NEW.description, NEW.brand, NEW.brand_id, NEW.category, NEW.category_id, NEW.gender,
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
    gender             = EXCLUDED.gender,
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
$function$;

CREATE OR REPLACE FUNCTION public.pmd_gender_to_master()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public._pm_pmd_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.gender IS DISTINCT FROM OLD.gender THEN
    PERFORM set_config('app.pm_pmd_sync', 'on', true);
    UPDATE products_master SET gender = NEW.gender WHERE sku_root = NEW.parent_sku;
    PERFORM set_config('app.pm_pmd_sync', 'off', true);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pmd_gender_to_master ON public.product_master_data;
CREATE TRIGGER trg_pmd_gender_to_master
AFTER UPDATE OF gender ON public.product_master_data
FOR EACH ROW EXECUTE FUNCTION public.pmd_gender_to_master();
