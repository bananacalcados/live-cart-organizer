ALTER TABLE public.live_member_sessions ADD COLUMN IF NOT EXISTS shipping_quote jsonb;
CREATE INDEX IF NOT EXISTS idx_customer_registrations_whatsapp ON public.customer_registrations (whatsapp);