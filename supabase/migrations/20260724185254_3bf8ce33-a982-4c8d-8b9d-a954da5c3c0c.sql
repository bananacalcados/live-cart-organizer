ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS expedition_stage text,
  ADD COLUMN IF NOT EXISTS expedition_group_id uuid,
  ADD COLUMN IF NOT EXISTS shipping_carrier text,
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS pickup_store_id uuid,
  ADD COLUMN IF NOT EXISTS expedition_finished_at timestamptz;

UPDATE public.pos_sales SET expedition_stage = 'concluido' WHERE expedition_stage IS NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_expedition_stage ON public.pos_sales(store_id, expedition_stage);

CREATE OR REPLACE FUNCTION public.set_pos_sale_expedition_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.expedition_stage IS NULL THEN
    IF NEW.sale_type IN ('live','online') THEN
      NEW.expedition_stage := 'novo';
    ELSE
      NEW.expedition_stage := 'concluido';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_pos_sale_expedition_stage ON public.pos_sales;
CREATE TRIGGER trg_set_pos_sale_expedition_stage
BEFORE INSERT ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.set_pos_sale_expedition_stage();

CREATE TABLE IF NOT EXISTS public.pos_expedition_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  sale_item_id uuid,
  barcode text,
  scanned boolean NOT NULL DEFAULT false,
  feet_ok boolean NOT NULL DEFAULT false,
  has_defect boolean NOT NULL DEFAULT false,
  notes text,
  checked_by uuid,
  checked_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_expedition_checks TO authenticated;
GRANT ALL ON public.pos_expedition_checks TO service_role;

ALTER TABLE public.pos_expedition_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage expedition checks"
ON public.pos_expedition_checks FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pos_expedition_checks_sale ON public.pos_expedition_checks(sale_id);

CREATE TRIGGER update_pos_expedition_checks_updated_at
BEFORE UPDATE ON public.pos_expedition_checks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();