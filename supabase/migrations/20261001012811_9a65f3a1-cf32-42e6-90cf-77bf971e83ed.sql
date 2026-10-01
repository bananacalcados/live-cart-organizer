REVOKE EXECUTE ON FUNCTION public.resolve_item_current_cost(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_pos_sale_item_cost_at_sale() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.dre_parameters (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tax_regime text NOT NULL DEFAULT 'aliquotas_item' CHECK (tax_regime IN ('simples','aliquotas_item')),
  simples_rate_pct numeric NOT NULL DEFAULT 0,
  commission_pct_store numeric NOT NULL DEFAULT 0,
  commission_pct_online numeric NOT NULL DEFAULT 0,
  commission_pct_live numeric NOT NULL DEFAULT 0,
  packaging_cost_per_shipped_order numeric NOT NULL DEFAULT 0,
  fixed_cost_allocation text NOT NULL DEFAULT 'by_revenue' CHECK (fixed_cost_allocation IN ('by_store','by_revenue')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.dre_parameters TO authenticated;
GRANT ALL ON public.dre_parameters TO service_role;
ALTER TABLE public.dre_parameters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read dre params" ON public.dre_parameters FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update dre params" ON public.dre_parameters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth insert dre params" ON public.dre_parameters FOR INSERT TO authenticated WITH CHECK (true);
CREATE TRIGGER trg_dre_parameters_updated BEFORE UPDATE ON public.dre_parameters FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();
INSERT INTO public.dre_parameters (id) VALUES (1) ON CONFLICT DO NOTHING;