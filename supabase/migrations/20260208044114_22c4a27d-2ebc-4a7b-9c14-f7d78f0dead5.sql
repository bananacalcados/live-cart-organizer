-- Create storage bucket for WhatsApp media
INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-media', 'whatsapp-media', true);

-- Allow anyone to upload to whatsapp-media bucket (for simplicity, no auth required)
CREATE POLICY "Allow public uploads to whatsapp-media"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'whatsapp-media');

-- Allow public read access
CREATE POLICY "Allow public read access to whatsapp-media"
ON storage.objects
FOR SELECT
USING (bucket_id = 'whatsapp-media');

-- Add media_type column to whatsapp_messages for tracking message types
ALTER TABLE public.whatsapp_messages 
ADD COLUMN IF NOT EXISTS media_type VARCHAR DEFAULT 'text',
ADD COLUMN IF NOT EXISTS media_url TEXT;