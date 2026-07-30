ALTER TABLE public.live_member_sessions ADD COLUMN IF NOT EXISTS shipping_quote JSONB;
CREATE INDEX IF NOT EXISTS idx_customer_registrations_whatsapp ON public.customer_registrations (whatsapp);
CREATE INDEX IF NOT EXISTS idx_customer_registrations_created_at ON public.customer_registrations (created_at DESC);