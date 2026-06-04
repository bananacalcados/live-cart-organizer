
-- MercadoPago: add a safe "has token" indicator and hide the secret columns from client roles
ALTER TABLE public.mercadopago_accounts
  ADD COLUMN IF NOT EXISTS has_access_token boolean
  GENERATED ALWAYS AS (access_token IS NOT NULL AND length(btrim(access_token)) > 0) STORED;

REVOKE ALL ON public.mercadopago_accounts FROM anon;
REVOKE SELECT ON public.mercadopago_accounts FROM authenticated;
GRANT SELECT (
  id, name, description, public_key, mp_user_id, app_number,
  is_sandbox, is_active, notes, created_at, updated_at, cnpj, has_access_token
) ON public.mercadopago_accounts TO authenticated;

-- Companies: hide the certificate password from client roles (kept readable only by service_role)
REVOKE ALL ON public.companies FROM anon;
REVOKE SELECT ON public.companies FROM authenticated;
GRANT SELECT (
  id, legal_name, trade_name, cnpj, ie, ie_isento, im, regime_tributario, crt, cnae_principal,
  address_cep, address_street, address_number, address_complement, address_neighborhood,
  address_city, address_city_ibge, address_state, address_country, email, phone, ambiente_nfe,
  brasilnfe_token, certificate_uploaded_at, certificate_expires_at, is_active, is_pilot, notes,
  created_at, updated_at, certificate_path, certificate_valid_until, certificate_filename
) ON public.companies TO authenticated;
