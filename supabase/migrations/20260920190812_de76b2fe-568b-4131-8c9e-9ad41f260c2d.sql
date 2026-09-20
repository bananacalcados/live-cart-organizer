CREATE TABLE public.expedition_grade_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  cor text,
  tipo_grade text,
  grades_qty numeric NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  arrival_date date NOT NULL,
  received boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expedition_grade_purchases TO authenticated;
GRANT ALL ON public.expedition_grade_purchases TO service_role;

ALTER TABLE public.expedition_grade_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage grade purchases"
ON public.expedition_grade_purchases FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_exp_grade_purchases_updated_at
BEFORE UPDATE ON public.expedition_grade_purchases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_exp_grade_purchases_arrival ON public.expedition_grade_purchases (arrival_date);