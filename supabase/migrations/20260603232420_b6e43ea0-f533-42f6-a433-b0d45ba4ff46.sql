-- Lock down the public checkout tables.
-- All anonymous checkout operations now go through the `checkout-public` edge
-- function (service_role). Anonymous (anon) access is removed; signed-in staff
-- (authenticated) and backend (service_role) retain full access.

-- ── pos_sales ──
DROP POLICY IF EXISTS "Allow all on pos_sales" ON public.pos_sales;
-- "Auth access pos_sales" (authenticated ALL) already exists and is kept.
REVOKE ALL ON public.pos_sales FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_sales TO authenticated;
GRANT ALL ON public.pos_sales TO service_role;

-- ── pos_sale_items ──
DROP POLICY IF EXISTS "Allow all on pos_sale_items" ON public.pos_sale_items;
CREATE POLICY "Auth access pos_sale_items" ON public.pos_sale_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.pos_sale_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_sale_items TO authenticated;
GRANT ALL ON public.pos_sale_items TO service_role;

-- ── pos_customers ──
DROP POLICY IF EXISTS "Allow all on pos_customers" ON public.pos_customers;
CREATE POLICY "Auth access pos_customers" ON public.pos_customers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.pos_customers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_customers TO authenticated;
GRANT ALL ON public.pos_customers TO service_role;

-- ── pos_checkout_attempts ──
DROP POLICY IF EXISTS "Anyone can insert checkout attempts" ON public.pos_checkout_attempts;
DROP POLICY IF EXISTS "Authenticated users can read checkout attempts" ON public.pos_checkout_attempts;
CREATE POLICY "Auth access pos_checkout_attempts" ON public.pos_checkout_attempts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE ALL ON public.pos_checkout_attempts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_checkout_attempts TO authenticated;
GRANT ALL ON public.pos_checkout_attempts TO service_role;