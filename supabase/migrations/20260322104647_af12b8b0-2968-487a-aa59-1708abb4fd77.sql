ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS is_mass_dispatch boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_mass_dispatch_message_id 
ON whatsapp_messages (message_id) 
WHERE is_mass_dispatch = true;