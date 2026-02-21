-- Allow anonymous users to read orders by ID (for public checkout links)
CREATE POLICY "Public read orders for checkout"
ON public.orders
FOR SELECT
TO anon
USING (true);

-- Allow anonymous users to update checkout_started_at on orders
CREATE POLICY "Public update checkout_started_at"
ON public.orders
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);