INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read media"
ON storage.objects FOR SELECT
USING (bucket_id = 'media');

CREATE POLICY "Authenticated upload media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'media');

CREATE POLICY "Authenticated update media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'media');

CREATE POLICY "Authenticated delete media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'media');