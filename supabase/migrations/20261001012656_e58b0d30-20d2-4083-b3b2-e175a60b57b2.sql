ALTER TABLE public.pos_sale_items ADD COLUMN IF NOT EXISTS cost_price_at_sale numeric, ADD COLUMN IF NOT EXISTS cost_source text;

CREATE OR REPLACE FUNCTION public.resolve_item_current_cost(p_sku text, p_barcode text, p_tiny text)
RETURNS TABLE(cost numeric, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric; vm uuid;
BEGIN
  SELECT pv.cost_price_override, pv.master_id INTO v, vm FROM product_variants pv
   WHERE (nullif(p_sku,'') IS NOT NULL AND pv.sku = p_sku) OR (nullif(p_barcode,'') IS NOT NULL AND pv.gtin = p_barcode)
   ORDER BY (pv.cost_price_override IS NOT NULL AND pv.cost_price_override > 0) DESC LIMIT 1;
  IF v IS NOT NULL AND v > 0 THEN cost := v; source := 'variant'; RETURN NEXT; RETURN; END IF;
  SELECT pp.cost_price INTO v FROM pos_products pp
   WHERE pp.cost_price > 0 AND ((nullif(p_tiny,'') IS NOT NULL AND pp.tiny_id::text = p_tiny)
      OR (nullif(p_sku,'') IS NOT NULL AND pp.sku = p_sku) OR (nullif(p_barcode,'') IS NOT NULL AND pp.barcode = p_barcode))
   LIMIT 1;
  IF v IS NOT NULL THEN cost := v; source := 'pos_product'; RETURN NEXT; RETURN; END IF;
  SELECT pm.cost_price INTO v FROM products_master pm
   WHERE pm.cost_price > 0 AND (pm.id = vm OR (nullif(p_tiny,'') IS NOT NULL AND pm.tiny_product_id = p_tiny))
   LIMIT 1;
  IF v IS NOT NULL THEN cost := v; source := 'master'; RETURN NEXT; RETURN; END IF;
  cost := NULL; source := 'none'; RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.trg_pos_sale_item_cost_at_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.cost_price_at_sale IS NULL THEN
    BEGIN
      SELECT * INTO r FROM public.resolve_item_current_cost(NEW.sku, NEW.barcode, NEW.tiny_product_id);
      NEW.cost_price_at_sale := r.cost;
      NEW.cost_source := r.source;
    EXCEPTION WHEN OTHERS THEN
      NEW.cost_source := 'none';
    END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_pos_sale_item_cost_at_sale BEFORE INSERT ON public.pos_sale_items
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_sale_item_cost_at_sale();