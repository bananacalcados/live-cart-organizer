CREATE POLICY "Anyone can update registrations"
  ON public.catalog_lead_registrations
  FOR UPDATE
  USING (true)
  WITH CHECK (true);