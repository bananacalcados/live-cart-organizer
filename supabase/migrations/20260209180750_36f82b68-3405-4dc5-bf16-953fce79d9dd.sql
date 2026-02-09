
-- Create chat_contacts table for storing contact display names
CREATE TABLE public.chat_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  display_name TEXT,
  custom_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chat_contacts ENABLE ROW LEVEL SECURITY;

-- Allow all access (no auth in this project)
CREATE POLICY "Allow all access to chat_contacts"
  ON public.chat_contacts
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add sender_name column to whatsapp_messages to capture push name from webhooks
ALTER TABLE public.whatsapp_messages ADD COLUMN sender_name TEXT;

-- Enable realtime for chat_contacts
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_contacts;
