ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS uazapi_proxy_mode text,
  ADD COLUMN IF NOT EXISTS uazapi_proxy_managed_country text,
  ADD COLUMN IF NOT EXISTS uazapi_proxy_managed_state text,
  ADD COLUMN IF NOT EXISTS uazapi_proxy_managed_city text;