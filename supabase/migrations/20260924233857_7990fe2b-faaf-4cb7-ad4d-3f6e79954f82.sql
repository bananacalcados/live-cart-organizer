CREATE OR REPLACE FUNCTION public.fill_pos_sale_item_size()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_size text;
BEGIN
  IF coalesce(trim(NEW.size),'') = '' THEN
    SELECT p.size INTO v_size FROM pos_products p
    WHERE coalesce(p.size,'') <> ''
      AND ((coalesce(NEW.sku,'') <> '' AND (p.sku = NEW.sku OR p.barcode = NEW.sku))
        OR (coalesce(NEW.barcode,'') <> '' AND p.barcode = NEW.barcode))
    LIMIT 1;
    IF v_size IS NOT NULL THEN NEW.size := v_size; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fill_pos_sale_item_size ON public.pos_sale_items;
CREATE TRIGGER trg_fill_pos_sale_item_size BEFORE INSERT OR UPDATE OF sku, barcode, size
ON public.pos_sale_items FOR EACH ROW EXECUTE FUNCTION public.fill_pos_sale_item_size();

ALTER TABLE public.pos_sale_items DISABLE TRIGGER trg_pos_sale_items_stock_movement;
ALTER TABLE public.pos_sale_items DISABLE TRIGGER trg_pos_sale_item_customer_attrs;
UPDATE public.pos_sale_items i SET size = sub.size
FROM (SELECT DISTINCT ON (i2.id) i2.id, p.size FROM pos_sale_items i2
      JOIN pos_products p ON (p.sku = i2.sku OR p.barcode = i2.sku OR (coalesce(i2.barcode,'')<>'' AND p.barcode=i2.barcode))
      WHERE coalesce(trim(i2.size),'')='' AND coalesce(p.size,'')<>'') sub
WHERE i.id = sub.id;
ALTER TABLE public.pos_sale_items ENABLE TRIGGER trg_pos_sale_items_stock_movement;
ALTER TABLE public.pos_sale_items ENABLE TRIGGER trg_pos_sale_item_customer_attrs;