-- Allow anonymous users to insert customer registrations from transparent checkout
CREATE POLICY "Public insert customer_registrations for checkout"
ON public.customer_registrations
FOR INSERT
TO anon
WITH CHECK (true);
