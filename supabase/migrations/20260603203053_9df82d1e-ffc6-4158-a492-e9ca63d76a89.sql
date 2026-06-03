-- marketing-attachments: keep public read (used via getPublicUrl in messages),
-- but restrict writes to authenticated users only.
DROP POLICY IF EXISTS "Allow all on marketing-attachments" ON storage.objects;

CREATE POLICY "Public read marketing-attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'marketing-attachments');

CREATE POLICY "Authenticated write marketing-attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'marketing-attachments');

CREATE POLICY "Authenticated update marketing-attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'marketing-attachments')
WITH CHECK (bucket_id = 'marketing-attachments');

CREATE POLICY "Authenticated delete marketing-attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'marketing-attachments');
