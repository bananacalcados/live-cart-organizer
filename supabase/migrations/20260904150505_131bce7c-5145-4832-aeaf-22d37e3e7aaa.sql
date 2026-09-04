ALTER TABLE public.live_whatsapp_clicks
  ADD COLUMN IF NOT EXISTS entered_phone text,
  ADD COLUMN IF NOT EXISTS entered_phone_key text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_live_whatsapp_clicks_entered_key
  ON public.live_whatsapp_clicks(entered_phone_key, created_at DESC)
  WHERE entered_phone_key IS NOT NULL;