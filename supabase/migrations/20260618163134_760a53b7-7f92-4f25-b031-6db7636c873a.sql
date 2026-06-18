
-- ============================================================
-- Lockdown de credenciais em whatsapp_numbers
-- Impede que os tokens (access_token, zapi_token, zapi_client_token,
-- uazapi_token, wasender_api_key, wasender_webhook_secret) sejam lidos
-- pelo cliente Supabase do front (mesmo por admins), mantendo todo o
-- restante funcionando. Edge functions usam service_role e não são afetadas.
-- A view whatsapp_numbers_safe é SECURITY DEFINER e continua intacta.
-- ============================================================

-- 1) Colunas geradas para indicar presença de token (sem expor o valor)
ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS has_meta_token boolean
    GENERATED ALWAYS AS (access_token IS NOT NULL AND length(access_token) > 0) STORED,
  ADD COLUMN IF NOT EXISTS has_zapi_token boolean
    GENERATED ALWAYS AS (zapi_token IS NOT NULL AND length(zapi_token) > 0) STORED,
  ADD COLUMN IF NOT EXISTS has_zapi_client_token boolean
    GENERATED ALWAYS AS (zapi_client_token IS NOT NULL AND length(zapi_client_token) > 0) STORED;

-- 2) Remove o SELECT amplo (todas as colunas) de authenticated
REVOKE SELECT ON public.whatsapp_numbers FROM authenticated;

-- 3) Concede SELECT apenas nas colunas NÃO sensíveis (exclui os tokens/segredos)
GRANT SELECT (
  id, label, phone_display, phone_number_id, business_account_id,
  is_default, is_active, created_at, updated_at, provider,
  zapi_instance_id, ai_paused, is_online, last_health_check, health_check_error,
  wasender_session_id, wasender_phone_number, wasender_last_qr, wasender_qr_updated_at,
  uazapi_instance_name, uazapi_owner, uazapi_last_qr, uazapi_qr_updated_at,
  uazapi_proxy_mode, uazapi_proxy_managed_country, uazapi_proxy_managed_state, uazapi_proxy_managed_city,
  has_meta_token, has_zapi_token, has_zapi_client_token
) ON public.whatsapp_numbers TO authenticated;

-- INSERT/UPDATE/DELETE permanecem (gravar token não é exposição); RLS (admin) continua gatekeeper.
-- service_role mantém ALL.
