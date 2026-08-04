CREATE OR REPLACE FUNCTION public.sync_order_stage_from_expedition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_ids uuid[];
BEGIN
  IF NEW.expedition_stage IS NOT DISTINCT FROM OLD.expedition_stage THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT s.source_order_id)
    INTO v_order_ids
  FROM public.pos_sales s
  WHERE s.source_order_id IS NOT NULL
    AND (
      s.id = NEW.id
      OR (NEW.expedition_group_id IS NOT NULL AND s.expedition_group_id = NEW.expedition_group_id)
    );

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.expedition_stage = 'concluido' THEN
    UPDATE public.orders
       SET stage = 'shipped', updated_at = now()
     WHERE id = ANY(v_order_ids)
       AND stage NOT IN ('cancelled', 'shipped');
  ELSIF OLD.expedition_stage = 'concluido' THEN
    UPDATE public.orders
       SET stage = 'completed', updated_at = now()
     WHERE id = ANY(v_order_ids)
       AND stage = 'shipped';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_stage_from_expedition ON public.pos_sales;
CREATE TRIGGER trg_sync_order_stage_from_expedition
AFTER UPDATE OF expedition_stage ON public.pos_sales
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_stage_from_expedition();