-- Create table for WhatsApp messages
CREATE TABLE public.whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'sent',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries by phone
CREATE INDEX idx_whatsapp_messages_phone ON public.whatsapp_messages(phone);
CREATE INDEX idx_whatsapp_messages_created_at ON public.whatsapp_messages(created_at DESC);

-- Enable RLS but allow all operations (public CRM without auth)
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Policy to allow all operations (adjust if you add auth later)
CREATE POLICY "Allow all operations on whatsapp_messages"
ON public.whatsapp_messages
FOR ALL
USING (true)
WITH CHECK (true);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;