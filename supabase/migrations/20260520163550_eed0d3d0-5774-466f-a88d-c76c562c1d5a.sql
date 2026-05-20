CREATE TABLE IF NOT EXISTS public.pos_crediario_gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_crediario_gateways ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read crediario gateways"
  ON public.pos_crediario_gateways FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert crediario gateways"
  ON public.pos_crediario_gateways FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update crediario gateways"
  ON public.pos_crediario_gateways FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete crediario gateways"
  ON public.pos_crediario_gateways FOR DELETE
  TO authenticated USING (true);

CREATE TRIGGER trg_pos_crediario_gateways_updated
  BEFORE UPDATE ON public.pos_crediario_gateways
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS crediario_gateway TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_sales_crediario_gateway
  ON public.pos_sales (crediario_gateway)
  WHERE crediario_gateway IS NOT NULL;