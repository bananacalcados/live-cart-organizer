ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS wasender_session_id integer,
  ADD COLUMN IF NOT EXISTS wasender_api_key text,
  ADD COLUMN IF NOT EXISTS wasender_webhook_secret text,
  ADD COLUMN IF NOT EXISTS wasender_phone_number text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_wasender_session
  ON public.whatsapp_numbers (wasender_session_id)
  WHERE wasender_session_id IS NOT NULL;