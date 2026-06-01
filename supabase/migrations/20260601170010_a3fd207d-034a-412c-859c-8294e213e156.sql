CREATE UNIQUE INDEX IF NOT EXISTS uniq_incoming_message_per_channel
ON public.whatsapp_messages (COALESCE(channel, 'whatsapp'), message_id)
WHERE direction = 'incoming' AND message_id IS NOT NULL;