
-- Table for planned fixed cost reductions (R$ per store per fixed cost)
CREATE TABLE public.cost_center_planned_fixed_cuts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL,
  fixed_cost_id UUID NOT NULL REFERENCES public.cost_center_fixed_costs(id) ON DELETE CASCADE,
  reduction_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, fixed_cost_id)
);

-- Table for planned variable cost reductions (percentage points per store per variable cost)
CREATE TABLE public.cost_center_planned_variable_cuts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL,
  variable_cost_id UUID NOT NULL REFERENCES public.cost_center_variable_costs(id) ON DELETE CASCADE,
  reduction_percentage NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, variable_cost_id)
);

-- Enable RLS
ALTER TABLE public.cost_center_planned_fixed_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_center_planned_variable_cuts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage fixed cuts" ON public.cost_center_planned_fixed_cuts
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage variable cuts" ON public.cost_center_planned_variable_cuts
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
