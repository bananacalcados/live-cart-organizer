CREATE TABLE public.stock_grade_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_grade_templates TO authenticated;
GRANT ALL ON public.stock_grade_templates TO service_role;
ALTER TABLE public.stock_grade_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage grade templates" ON public.stock_grade_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_stock_grade_templates_updated BEFORE UPDATE ON public.stock_grade_templates
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();