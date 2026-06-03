-- fiscal-documents is now a private bucket. Remove the broad public read/list
-- policy. Access is via long-lived signed URLs (customers) and service_role
-- (backend render/download).
DROP POLICY IF EXISTS "Public read fiscal-documents" ON storage.objects;

-- Allow signed-in staff to read fiscal-documents objects directly if needed.
CREATE POLICY "Authenticated read fiscal-documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'fiscal-documents');
