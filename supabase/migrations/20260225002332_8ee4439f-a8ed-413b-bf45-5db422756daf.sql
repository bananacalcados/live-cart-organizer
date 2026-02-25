
-- Tighten RLS policies created in previous migration (avoid USING/WITH CHECK true)

-- cost_center_fixed_costs
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.cost_center_fixed_costs;
CREATE POLICY "cost_center_fixed_costs_select_auth"
ON public.cost_center_fixed_costs
FOR SELECT
USING (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_fixed_costs_insert_auth"
ON public.cost_center_fixed_costs
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_fixed_costs_update_auth"
ON public.cost_center_fixed_costs
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_fixed_costs_delete_auth"
ON public.cost_center_fixed_costs
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- cost_center_store_fixed_costs
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.cost_center_store_fixed_costs;
CREATE POLICY "cost_center_store_fixed_costs_select_auth"
ON public.cost_center_store_fixed_costs
FOR SELECT
USING (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_store_fixed_costs_insert_auth"
ON public.cost_center_store_fixed_costs
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_store_fixed_costs_update_auth"
ON public.cost_center_store_fixed_costs
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_store_fixed_costs_delete_auth"
ON public.cost_center_store_fixed_costs
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- cost_center_variable_costs
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.cost_center_variable_costs;
CREATE POLICY "cost_center_variable_costs_select_auth"
ON public.cost_center_variable_costs
FOR SELECT
USING (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_variable_costs_insert_auth"
ON public.cost_center_variable_costs
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_variable_costs_update_auth"
ON public.cost_center_variable_costs
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cost_center_variable_costs_delete_auth"
ON public.cost_center_variable_costs
FOR DELETE
USING (auth.uid() IS NOT NULL);
