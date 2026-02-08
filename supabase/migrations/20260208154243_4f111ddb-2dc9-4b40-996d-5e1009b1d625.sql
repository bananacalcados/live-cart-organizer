-- Add tags column to customers table
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Add is_group column to whatsapp_messages for identifying group chats
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS is_group boolean DEFAULT false;