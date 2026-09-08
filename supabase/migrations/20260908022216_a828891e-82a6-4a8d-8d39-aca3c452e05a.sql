ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS is_sedex boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_pos_sales_is_sedex ON public.pos_sales (is_sedex) WHERE is_sedex;

CREATE OR REPLACE FUNCTION public.pos_sales_apply_sedex_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_order_id IS NOT NULL AND COALESCE(NEW.is_sedex, false) = false THEN
    SELECT COALESCE(o.is_sedex, false) INTO NEW.is_sedex
    FROM public.orders o WHERE o.id = NEW.source_order_id;
    NEW.is_sedex := COALESCE(NEW.is_sedex, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sales_apply_sedex ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_apply_sedex
BEFORE INSERT ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.pos_sales_apply_sedex_on_insert();

CREATE OR REPLACE FUNCTION public.orders_propagate_sedex_to_pos_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pos_sales s
     SET is_sedex = COALESCE(NEW.is_sedex, false)
   WHERE (s.source_order_id = NEW.id OR s.id = NEW.pos_sale_id)
     AND COALESCE(s.is_sedex, false) IS DISTINCT FROM COALESCE(NEW.is_sedex, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_propagate_sedex_pos ON public.orders;
CREATE TRIGGER trg_orders_propagate_sedex_pos
AFTER UPDATE OF is_sedex ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_propagate_sedex_to_pos_sales();

UPDATE public.pos_sales s
   SET is_sedex = true
  FROM public.orders o
 WHERE o.is_sedex
   AND (s.source_order_id = o.id OR s.id = o.pos_sale_id)
   AND s.is_sedex = false;