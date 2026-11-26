CREATE OR REPLACE FUNCTION public.normalize_variant_price_overrides()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale numeric; v_cost numeric;
BEGIN
  SELECT sale_price, cost_price INTO v_sale, v_cost FROM public.products_master WHERE id = NEW.master_id;
  IF TG_OP = 'INSERT' OR NEW.sale_price_override IS DISTINCT FROM OLD.sale_price_override THEN
    IF NEW.sale_price_override IS NOT NULL AND (NEW.sale_price_override <= 0 OR NEW.sale_price_override = v_sale) THEN
      NEW.sale_price_override := NULL;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.cost_price_override IS DISTINCT FROM OLD.cost_price_override THEN
    IF NEW.cost_price_override IS NOT NULL AND (NEW.cost_price_override <= 0 OR NEW.cost_price_override = v_cost) THEN
      NEW.cost_price_override := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_normalize_variant_price_overrides
BEFORE INSERT OR UPDATE OF sale_price_override, cost_price_override ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.normalize_variant_price_overrides();

CREATE OR REPLACE FUNCTION public.propagate_master_price_to_pos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.sale_price IS NULL OR NEW.sale_price <= 0 THEN RETURN NEW; END IF;
  PERFORM set_config('app.sync_in_progress','on',true);
  UPDATE public.pos_products pp
     SET price = NEW.sale_price, updated_at = now()
   WHERE pp.price IS DISTINCT FROM NEW.sale_price
     AND EXISTS (
       SELECT 1 FROM public.product_variants v
        WHERE v.master_id = NEW.id
          AND COALESCE(v.sale_price_override,0) = 0
          AND ((v.tiny_variant_id IS NOT NULL AND v.tiny_variant_id = pp.tiny_id::text)
            OR (v.sku  IS NOT NULL AND v.sku  = pp.sku)
            OR (v.gtin IS NOT NULL AND v.gtin = pp.barcode)));
  PERFORM set_config('app.sync_in_progress','off',true);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_master_price_to_pos
AFTER UPDATE OF sale_price ON public.products_master
FOR EACH ROW WHEN (OLD.sale_price IS DISTINCT FROM NEW.sale_price)
EXECUTE FUNCTION public.propagate_master_price_to_pos();

CREATE OR REPLACE FUNCTION public.propagate_variant_price_to_pos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_price numeric;
BEGIN
  IF public.is_sync_in_progress() THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(NEW.sale_price_override,0), m.sale_price)
    INTO v_price FROM public.products_master m WHERE m.id = NEW.master_id;
  IF v_price IS NULL OR v_price <= 0 THEN RETURN NEW; END IF;
  PERFORM set_config('app.sync_in_progress','on',true);
  UPDATE public.pos_products pp
     SET price = v_price, updated_at = now()
   WHERE pp.price IS DISTINCT FROM v_price
     AND ((NEW.tiny_variant_id IS NOT NULL AND pp.tiny_id::text = NEW.tiny_variant_id)
       OR (NEW.sku  IS NOT NULL AND pp.sku = NEW.sku)
       OR (NEW.gtin IS NOT NULL AND pp.barcode = NEW.gtin));
  PERFORM set_config('app.sync_in_progress','off',true);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_variant_price_to_pos
AFTER UPDATE OF sale_price_override ON public.product_variants
FOR EACH ROW WHEN (OLD.sale_price_override IS DISTINCT FROM NEW.sale_price_override)
EXECUTE FUNCTION public.propagate_variant_price_to_pos();

REVOKE EXECUTE ON FUNCTION public.normalize_variant_price_overrides() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.propagate_master_price_to_pos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.propagate_variant_price_to_pos() FROM PUBLIC, anon, authenticated;