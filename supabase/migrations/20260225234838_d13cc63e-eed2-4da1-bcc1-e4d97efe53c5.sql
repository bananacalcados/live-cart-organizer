
ALTER TABLE public.cost_center_planned_fixed_cuts ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.cost_center_planned_variable_cuts ADD COLUMN IF NOT EXISTS description TEXT;
