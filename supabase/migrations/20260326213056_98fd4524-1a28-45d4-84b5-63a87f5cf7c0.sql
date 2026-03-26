
CREATE INDEX IF NOT EXISTS idx_wm_phone_number_created 
ON public.whatsapp_messages (phone, whatsapp_number_id, created_at DESC);
