ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS instagram_account_id text,
  ADD COLUMN IF NOT EXISTS instagram_username text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_ig_account
  ON public.whatsapp_numbers(instagram_account_id)
  WHERE instagram_account_id IS NOT NULL;

CREATE OR REPLACE VIEW public.whatsapp_numbers_safe AS
SELECT id,
    label,
    phone_display,
    phone_number_id,
    business_account_id,
    is_default,
    is_active,
    created_at,
    updated_at,
    provider,
    zapi_instance_id,
    ai_paused,
    is_online,
    last_health_check,
    wasender_session_id,
    wasender_phone_number,
    uazapi_instance_name,
    uazapi_owner,
    uazapi_proxy_mode,
    uazapi_proxy_managed_country,
    uazapi_proxy_managed_state,
    uazapi_proxy_managed_city,
    instagram_account_id,
    instagram_username
   FROM public.whatsapp_numbers;