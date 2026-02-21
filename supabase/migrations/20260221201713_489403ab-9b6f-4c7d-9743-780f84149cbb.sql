-- Allow anonymous users to read customers for checkout order JOIN
CREATE POLICY "Public read customers for checkout"
ON public.customers
FOR SELECT
TO anon
USING (true);