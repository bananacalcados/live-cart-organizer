DROP POLICY IF EXISTS "public registers catalog lead" ON public.catalog_lead_registrations;
CREATE POLICY "public registers catalog lead" ON public.catalog_lead_registrations FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(whatsapp) BETWEEN 8 AND 20 AND whatsapp ~ '^\d+$'
    AND length(instagram_handle) <= 80
    AND status = 'browsing'
    AND checkout_sale_id IS NULL AND pix_code IS NULL AND pix_expires_at IS NULL
    AND (cart_total IS NULL OR cart_total >= 0)
    AND (cart_items IS NULL OR pg_column_size(cart_items) <= 20000)
    AND COALESCE(recovery_disparo,0) = 0 AND recovery_session_id IS NULL);
DROP POLICY IF EXISTS lp_leads_public_insert ON public.lp_leads;
CREATE POLICY lp_leads_public_insert ON public.lp_leads FOR INSERT TO anon
  WITH CHECK (
    length(campaign_tag) BETWEEN 1 AND 120
    AND (phone IS NULL OR length(phone) <= 25)
    AND (name IS NULL OR length(name) <= 150)
    AND (email IS NULL OR length(email) <= 200)
    AND (instagram IS NULL OR length(instagram) <= 100)
    AND (source IS NULL OR length(source) <= 100)
    AND (metadata IS NULL OR pg_column_size(metadata) <= 8000)
    AND COALESCE(converted,false) = false AND converted_at IS NULL
    AND COALESCE(recovery_disparo,0) = 0 AND recovery_session_id IS NULL);