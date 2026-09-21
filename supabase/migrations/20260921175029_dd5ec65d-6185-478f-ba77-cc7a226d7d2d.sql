CREATE INDEX IF NOT EXISTS idx_wm_sender_name_trgm ON public.whatsapp_messages USING gin (sender_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wm_channel_created ON public.whatsapp_messages (channel, created_at DESC);
ANALYZE public.whatsapp_messages;