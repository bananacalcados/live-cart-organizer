
-- Create chat-media storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read files (public bucket)
CREATE POLICY "Public read chat-media" ON storage.objects
FOR SELECT USING (bucket_id = 'chat-media');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated upload chat-media" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'chat-media' AND auth.role() = 'authenticated');

-- Allow authenticated users to update their files
CREATE POLICY "Authenticated update chat-media" ON storage.objects
FOR UPDATE USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete their files
CREATE POLICY "Authenticated delete chat-media" ON storage.objects
FOR DELETE USING (bucket_id = 'chat-media' AND auth.role() = 'authenticated');
