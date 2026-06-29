CREATE POLICY "Auth insert customer_registrations"
ON public.customer_registrations
FOR INSERT
TO authenticated
WITH CHECK (true);
