-- Helper: equipe = admin/manager/user ou com algum módulo liberado (login Google sem permissão NÃO conta).
CREATE OR REPLACE FUNCTION public.is_team_member(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid)
    OR EXISTS (SELECT 1 FROM public.user_module_permissions WHERE user_id = _uid));
$$;
REVOKE ALL ON FUNCTION public.is_team_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid) TO authenticated, service_role;

-- 1) Tabelas sem RLS
REVOKE ALL ON public.audit_link, public.audit_mirror FROM anon, authenticated;
GRANT ALL ON public.audit_link, public.audit_mirror TO service_role;
GRANT SELECT ON public.audit_link, public.audit_mirror TO authenticated;
ALTER TABLE public.audit_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_mirror ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit_link" ON public.audit_link FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins read audit_mirror" ON public.audit_mirror FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

REVOKE ALL ON public.model_number_tokens, public.variant_stock_cache FROM anon, authenticated;
GRANT ALL ON public.model_number_tokens, public.variant_stock_cache TO service_role;
GRANT SELECT ON public.model_number_tokens, public.variant_stock_cache TO authenticated;
ALTER TABLE public.model_number_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variant_stock_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team reads model_number_tokens" ON public.model_number_tokens FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "team reads variant_stock_cache" ON public.variant_stock_cache FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

REVOKE ALL ON public.product_color_shopify_alias FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_color_shopify_alias TO authenticated;
GRANT ALL ON public.product_color_shopify_alias TO service_role;
ALTER TABLE public.product_color_shopify_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages color alias" ON public.product_color_shopify_alias FOR ALL TO authenticated
  USING (public.is_team_member(auth.uid())) WITH CHECK (public.is_team_member(auth.uid()));

-- 2) Formulários públicos: anon só insere (com validação), equipe lê/gerencia.
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.catalog_lead_registrations, public.lp_leads FROM anon;
REVOKE ALL ON public.link_page_leads, public.link_page_visits, public.product_visual_tags FROM anon;

DROP POLICY IF EXISTS "Anyone can insert registrations" ON public.catalog_lead_registrations;
DROP POLICY IF EXISTS "Authenticated can update registrations" ON public.catalog_lead_registrations;
DROP POLICY IF EXISTS "Authenticated can view registrations" ON public.catalog_lead_registrations;
CREATE POLICY "public registers catalog lead" ON public.catalog_lead_registrations FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(whatsapp) BETWEEN 8 AND 20 AND whatsapp ~ '^\d+$'
    AND length(instagram_handle) <= 80
    AND status = 'browsing'
    AND checkout_sale_id IS NULL AND pix_code IS NULL AND pix_expires_at IS NULL
    AND (cart_total IS NULL OR cart_total >= 0)
    AND (cart_items IS NULL OR pg_column_size(cart_items) <= 20000)
    AND recovery_disparo IS NULL AND recovery_session_id IS NULL);
CREATE POLICY "team reads catalog leads" ON public.catalog_lead_registrations FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));
CREATE POLICY "team updates catalog leads" ON public.catalog_lead_registrations FOR UPDATE TO authenticated
  USING (public.is_team_member(auth.uid())) WITH CHECK (public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Public can register lead" ON public.link_page_leads;
DROP POLICY IF EXISTS "Authenticated manage leads" ON public.link_page_leads;
CREATE POLICY "team manages link page leads" ON public.link_page_leads FOR ALL TO authenticated
  USING (public.is_team_member(auth.uid())) WITH CHECK (public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Anyone can insert visits" ON public.link_page_visits;
DROP POLICY IF EXISTS "Authenticated users can view visits" ON public.link_page_visits;
CREATE POLICY "team reads link page visits" ON public.link_page_visits FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS lp_leads_anon_insert ON public.lp_leads;
DROP POLICY IF EXISTS lp_leads_auth_all ON public.lp_leads;
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
    AND recovery_disparo IS NULL AND recovery_session_id IS NULL);
CREATE POLICY lp_leads_team_all ON public.lp_leads FOR ALL TO authenticated
  USING (public.is_team_member(auth.uid())) WITH CHECK (public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Visual tags are publicly readable" ON public.product_visual_tags;
CREATE POLICY "team reads visual tags" ON public.product_visual_tags FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

-- 3) Storage
DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete receipts" ON storage.objects;
CREATE POLICY "team reads payment receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.is_team_member(auth.uid()));
CREATE POLICY "team uploads payment receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-receipts' AND public.is_team_member(auth.uid()));
CREATE POLICY "team deletes payment receipts" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read boletos storage" ON storage.objects;
CREATE POLICY "finance reads boletos storage" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'boletos' AND (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'pos') OR public.has_module_access(auth.uid(),'management')));

DROP POLICY IF EXISTS "Authenticated read fiscal-documents" ON storage.objects;
CREATE POLICY "fiscal staff reads fiscal-documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fiscal-documents' AND (public.has_role(auth.uid(),'admin') OR public.has_module_access(auth.uid(),'pos') OR public.has_module_access(auth.uid(),'expedition') OR public.has_module_access(auth.uid(),'management')));

DROP POLICY IF EXISTS "Allow public uploads to whatsapp-media" ON storage.objects;
CREATE POLICY "team uploads whatsapp-media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-media' AND public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Authenticated upload chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete chat-media" ON storage.objects;
CREATE POLICY "team uploads chat-media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media' AND public.is_team_member(auth.uid()));
CREATE POLICY "team updates chat-media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-media' AND public.is_team_member(auth.uid())) WITH CHECK (bucket_id = 'chat-media' AND public.is_team_member(auth.uid()));
CREATE POLICY "team deletes chat-media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Admins can upload fiscal certificates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can read fiscal certificates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update fiscal certificates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete fiscal certificates" ON storage.objects;
CREATE POLICY "Admins can upload fiscal certificates" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins can read fiscal certificates" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins can update fiscal certificates" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(),'admin')) WITH CHECK (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins can delete fiscal certificates" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Admins update financial receipts" ON storage.objects;
CREATE POLICY "Admins update financial receipts" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(),'admin')) WITH CHECK (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Auth upload event-landing-assets" ON storage.objects;
DROP POLICY IF EXISTS "Auth update event-landing-assets" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete event-landing-assets" ON storage.objects;
CREATE POLICY "Auth upload event-landing-assets" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-landing-assets' AND public.is_team_member(auth.uid()));
CREATE POLICY "Auth update event-landing-assets" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'event-landing-assets' AND public.is_team_member(auth.uid())) WITH CHECK (bucket_id = 'event-landing-assets' AND public.is_team_member(auth.uid()));
CREATE POLICY "Auth delete event-landing-assets" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'event-landing-assets' AND public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Authenticated upload media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete media" ON storage.objects;
CREATE POLICY "Authenticated upload media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND public.is_team_member(auth.uid()));
CREATE POLICY "Authenticated update media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND public.is_team_member(auth.uid())) WITH CHECK (bucket_id = 'media' AND public.is_team_member(auth.uid()));
CREATE POLICY "Authenticated delete media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND public.is_team_member(auth.uid()));

DROP POLICY IF EXISTS "Authenticated write marketing-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update marketing-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete marketing-attachments" ON storage.objects;
CREATE POLICY "Authenticated write marketing-attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'marketing-attachments' AND public.is_team_member(auth.uid()));
CREATE POLICY "Authenticated update marketing-attachments" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'marketing-attachments' AND public.is_team_member(auth.uid())) WITH CHECK (bucket_id = 'marketing-attachments' AND public.is_team_member(auth.uid()));
CREATE POLICY "Authenticated delete marketing-attachments" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'marketing-attachments' AND public.is_team_member(auth.uid()));