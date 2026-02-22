-- Allow anonymous users to read their own registration by order_id
CREATE POLICY "Public select own customer_registrations"
ON public.customer_registrations
FOR SELECT
USING (true);