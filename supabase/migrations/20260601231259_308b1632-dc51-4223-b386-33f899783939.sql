ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS uazapi_instance_name text,
  ADD COLUMN IF NOT EXISTS uazapi_token text,
  ADD COLUMN IF NOT EXISTS uazapi_owner text,
  ADD COLUMN IF NOT EXISTS uazapi_last_qr text,
  ADD COLUMN IF NOT EXISTS uazapi_qr_updated_at timestamptz;