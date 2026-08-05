ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS sale_released_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pos_sales_store_released
  ON public.pos_sales (store_id, sale_released_at);

CREATE OR REPLACE FUNCTION public.pos_sales_release_on_expedition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Vendas fora do fluxo de expedição (balcão, retirada, condicional) já nascem liberadas
  IF TG_OP = 'INSERT' THEN
    IF NEW.sale_released_at IS NULL
       AND (COALESCE(NEW.sale_type, '') NOT IN ('live','online')
            OR COALESCE(NEW.expedition_stage, '') = 'concluido') THEN
      NEW.sale_released_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.expedition_stage, '') = 'concluido'
     AND COALESCE(OLD.expedition_stage, '') <> 'concluido' THEN
    IF NEW.sale_released_at IS NULL THEN
      NEW.sale_released_at := now();
    END IF;
  ELSIF COALESCE(OLD.expedition_stage, '') = 'concluido'
        AND COALESCE(NEW.expedition_stage, '') <> 'concluido' THEN
    NEW.sale_released_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sales_release_on_expedition ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_release_on_expedition
BEFORE INSERT OR UPDATE OF expedition_stage ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.pos_sales_release_on_expedition();

-- Backfill: histórico não pode sumir
UPDATE public.pos_sales
SET sale_released_at = COALESCE(expedition_finished_at, paid_at, created_at)
WHERE sale_released_at IS NULL
  AND (COALESCE(sale_type, '') NOT IN ('live','online')
       OR COALESCE(expedition_stage, '') = 'concluido');