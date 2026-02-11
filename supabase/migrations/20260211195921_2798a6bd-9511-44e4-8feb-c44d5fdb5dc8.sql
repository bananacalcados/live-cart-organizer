-- Add Z-API support columns to whatsapp_numbers
ALTER TABLE public.whatsapp_numbers 
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS zapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS zapi_token TEXT,
  ADD COLUMN IF NOT EXISTS zapi_client_token TEXT;

-- Add comment for clarity
COMMENT ON COLUMN public.whatsapp_numbers.provider IS 'meta or zapi';
