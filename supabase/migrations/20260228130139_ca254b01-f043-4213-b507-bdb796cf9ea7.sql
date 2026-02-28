
-- Sub-items for fixed costs (per store)
CREATE TABLE public.cost_center_fixed_cost_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fixed_cost_id UUID NOT NULL REFERENCES public.cost_center_fixed_costs(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_center_fixed_cost_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage fixed cost items"
ON public.cost_center_fixed_cost_items FOR ALL
USING (true) WITH CHECK (true);

CREATE TRIGGER update_fixed_cost_items_updated_at
BEFORE UPDATE ON public.cost_center_fixed_cost_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
