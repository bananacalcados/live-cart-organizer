
-- Add BrasilNFe + A1 certificate fields to companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS brasilnfe_token TEXT,
  ADD COLUMN IF NOT EXISTS certificate_path TEXT,
  ADD COLUMN IF NOT EXISTS certificate_password TEXT,
  ADD COLUMN IF NOT EXISTS certificate_valid_until DATE,
  ADD COLUMN IF NOT EXISTS certificate_filename TEXT,
  ADD COLUMN IF NOT EXISTS certificate_uploaded_at TIMESTAMPTZ;

-- Private bucket for A1 certificates
INSERT INTO storage.buckets (id, name, public)
VALUES ('fiscal-certificates', 'fiscal-certificates', false)
ON CONFLICT (id) DO NOTHING;

-- Admin-only access to fiscal-certificates bucket
DROP POLICY IF EXISTS "Admins can read fiscal certificates" ON storage.objects;
CREATE POLICY "Admins can read fiscal certificates"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can upload fiscal certificates" ON storage.objects;
CREATE POLICY "Admins can upload fiscal certificates"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update fiscal certificates" ON storage.objects;
CREATE POLICY "Admins can update fiscal certificates"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete fiscal certificates" ON storage.objects;
CREATE POLICY "Admins can delete fiscal certificates"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'fiscal-certificates' AND public.has_role(auth.uid(), 'admin'));
