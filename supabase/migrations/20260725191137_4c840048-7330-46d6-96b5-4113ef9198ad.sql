CREATE POLICY "Public can read checkout settings"
ON public.app_settings
FOR SELECT
TO anon
USING (key IN ('pix_discount_percent', 'installment_config'));