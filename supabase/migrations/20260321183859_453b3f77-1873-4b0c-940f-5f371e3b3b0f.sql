CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_message_id 
ON public.whatsapp_messages (message_id) 
WHERE message_id IS NOT NULL;