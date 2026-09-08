CREATE OR REPLACE FUNCTION public.expedition_apply_sedex_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE k text;
BEGIN
  k := right(regexp_replace(coalesce(NEW.customer_phone, ''), '\D', '', 'g'), 8);
  IF length(k) = 8 THEN
    IF EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE o.is_sedex
        AND right(regexp_replace(coalesce(c.whatsapp, ''), '\D', '', 'g'), 8) = k
        AND o.created_at > now() - interval '45 days'
    ) THEN
      NEW.priority_sedex := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expedition_apply_sedex ON public.expedition_orders;
CREATE TRIGGER trg_expedition_apply_sedex
BEFORE INSERT ON public.expedition_orders
FOR EACH ROW EXECUTE FUNCTION public.expedition_apply_sedex_on_insert();

CREATE OR REPLACE FUNCTION public.orders_propagate_sedex()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE k text;
BEGIN
  IF NEW.is_sedex IS DISTINCT FROM OLD.is_sedex THEN
    SELECT right(regexp_replace(coalesce(c.whatsapp, ''), '\D', '', 'g'), 8)
      INTO k FROM public.customers c WHERE c.id = NEW.customer_id;
    IF k IS NOT NULL AND length(k) = 8 THEN
      UPDATE public.expedition_orders eo
      SET priority_sedex = NEW.is_sedex
      WHERE right(regexp_replace(coalesce(eo.customer_phone, ''), '\D', '', 'g'), 8) = k
        AND eo.created_at > now() - interval '45 days';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_propagate_sedex ON public.orders;
CREATE TRIGGER trg_orders_propagate_sedex
AFTER UPDATE OF is_sedex ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_propagate_sedex();