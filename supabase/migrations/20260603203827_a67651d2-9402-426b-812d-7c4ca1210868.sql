-- Restrict the credential-bearing base table to admins only.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='whatsapp_numbers'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_numbers', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage whatsapp_numbers"
ON public.whatsapp_numbers FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.whatsapp_numbers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_numbers TO authenticated;
GRANT ALL ON public.whatsapp_numbers TO service_role;

-- Credential-free view for non-admin staff reads.
DROP VIEW IF EXISTS public.whatsapp_numbers_safe;
CREATE VIEW public.whatsapp_numbers_safe AS
SELECT
  id, label, phone_display, phone_number_id, business_account_id,
  is_default, is_active, created_at, updated_at, provider,
  zapi_instance_id, ai_paused, is_online, last_health_check,
  wasender_session_id, wasender_phone_number,
  uazapi_instance_name, uazapi_owner, uazapi_proxy_mode,
  uazapi_proxy_managed_country, uazapi_proxy_managed_state, uazapi_proxy_managed_city
FROM public.whatsapp_numbers;

REVOKE ALL ON public.whatsapp_numbers_safe FROM anon;
GRANT SELECT ON public.whatsapp_numbers_safe TO authenticated;
GRANT SELECT ON public.whatsapp_numbers_safe TO service_role;
