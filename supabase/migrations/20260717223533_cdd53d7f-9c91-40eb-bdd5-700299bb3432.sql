
ALTER TABLE public.pos_stock_adjustments
  ADD COLUMN IF NOT EXISTS movement_type text,
  ADD COLUMN IF NOT EXISTS exchange_id uuid REFERENCES public.trocas_devolucoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exchange_number text,
  ADD COLUMN IF NOT EXISTS count_id uuid REFERENCES public.inventory_counts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS user_name text;

CREATE INDEX IF NOT EXISTS idx_psa_product_created
  ON public.pos_stock_adjustments(product_id, created_at DESC);

UPDATE public.pos_stock_adjustments SET movement_type = CASE
  WHEN sale_id IS NOT NULL THEN 'venda'
  WHEN reason ILIKE '%balanço%' OR reason ILIKE '%balanco%' THEN 'balanco'
  WHEN reason ILIKE '%transfer%' THEN 'transferencia'
  WHEN reason ILIKE '%devoluç%' OR reason ILIKE '%devoluc%' THEN 'devolucao'
  WHEN reason ILIKE '%troca%' THEN 'troca'
  WHEN direction = 'in' THEN 'entrada'
  ELSE 'saida'
END WHERE movement_type IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psa_movement_type_chk') THEN
    ALTER TABLE public.pos_stock_adjustments
      ADD CONSTRAINT psa_movement_type_chk
      CHECK (movement_type IN ('entrada','saida','balanco','venda','troca','devolucao','transferencia','ajuste'));
  END IF;
END $$;

-- Trigger de blindagem: registra ajuste quando UPDATE de stock não gerou histórico
CREATE OR REPLACE FUNCTION public.log_pos_products_stock_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent_exists boolean;
  delta numeric;
BEGIN
  IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.pos_stock_adjustments
    WHERE product_id = NEW.id
      AND created_at > now() - interval '3 seconds'
  ) INTO recent_exists;

  IF recent_exists THEN
    RETURN NEW;
  END IF;

  delta := COALESCE(NEW.stock,0) - COALESCE(OLD.stock,0);

  INSERT INTO public.pos_stock_adjustments (
    store_id, product_id, sku, barcode, product_name,
    direction, quantity, previous_stock, new_stock,
    reason, movement_type
  ) VALUES (
    NEW.store_id, NEW.id, NEW.sku, NEW.barcode, COALESCE(NEW.name,'—'),
    CASE WHEN delta >= 0 THEN 'in' ELSE 'out' END,
    ABS(delta), OLD.stock, NEW.stock,
    'Ajuste direto sem classificação (blindagem automática)',
    'ajuste'
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_pos_products_stock_change ON public.pos_products;
CREATE TRIGGER trg_log_pos_products_stock_change
AFTER UPDATE OF stock ON public.pos_products
FOR EACH ROW EXECUTE FUNCTION public.log_pos_products_stock_change();
