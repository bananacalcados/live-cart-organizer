ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gift_description text;

ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS has_gift boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_description text,
  ADD COLUMN IF NOT EXISTS gift_added_at timestamptz,
  ADD COLUMN IF NOT EXISTS gift_after_completion boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.propagate_order_gift_to_pos_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (COALESCE(NEW.has_gift,false) IS DISTINCT FROM COALESCE(OLD.has_gift,false))
     OR (COALESCE(NEW.gift_description,'') IS DISTINCT FROM COALESCE(OLD.gift_description,'')) THEN
    UPDATE public.pos_sales s
       SET has_gift = COALESCE(NEW.has_gift,false),
           gift_description = NULLIF(btrim(COALESCE(NEW.gift_description,'')),''),
           gift_added_at = CASE WHEN COALESCE(NEW.has_gift,false) THEN now() ELSE NULL END,
           gift_after_completion = CASE
             WHEN COALESCE(NEW.has_gift,false) AND s.expedition_stage = 'concluido' THEN true
             WHEN COALESCE(NEW.has_gift,false) THEN s.gift_after_completion
             ELSE false END
     WHERE s.id = NEW.pos_sale_id OR s.source_order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_order_gift ON public.orders;
CREATE TRIGGER trg_propagate_order_gift
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.propagate_order_gift_to_pos_sale();

CREATE OR REPLACE FUNCTION public.inherit_gift_from_source_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE o RECORD;
BEGIN
  IF NEW.source_order_id IS NOT NULL AND COALESCE(NEW.has_gift,false) = false THEN
    SELECT has_gift, gift_description INTO o FROM public.orders WHERE id = NEW.source_order_id;
    IF FOUND AND COALESCE(o.has_gift,false) THEN
      NEW.has_gift := true;
      NEW.gift_description := NULLIF(btrim(COALESCE(o.gift_description,'')),'');
      NEW.gift_added_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inherit_gift_from_order ON public.pos_sales;
CREATE TRIGGER trg_inherit_gift_from_order
BEFORE INSERT ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.inherit_gift_from_source_order();

UPDATE public.pos_sales s
   SET has_gift = true,
       gift_description = NULLIF(btrim(COALESCE(o.gift_description,'')),''),
       gift_added_at = COALESCE(s.gift_added_at, now())
  FROM public.orders o
 WHERE COALESCE(o.has_gift,false) = true
   AND (s.id = o.pos_sale_id OR s.source_order_id = o.id)
   AND COALESCE(s.has_gift,false) = false;