CREATE INDEX IF NOT EXISTS idx_customers_instagram_trgm ON public.customers USING gin (instagram_handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_unified_phone_e164_trgm ON public.customers_unified USING gin (phone_e164 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wm_channel_sender_trgm ON public.whatsapp_messages USING gin (sender_name gin_trgm_ops) WHERE channel = 'instagram';