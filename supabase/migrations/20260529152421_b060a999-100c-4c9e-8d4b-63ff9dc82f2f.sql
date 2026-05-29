ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS wasender_last_qr text,
  ADD COLUMN IF NOT EXISTS wasender_qr_updated_at timestamptz;