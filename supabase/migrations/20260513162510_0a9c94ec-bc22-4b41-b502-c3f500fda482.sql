-- Enable realtime for pos_sales and fiscal_documents
ALTER TABLE public.pos_sales REPLICA IDENTITY FULL;
ALTER TABLE public.fiscal_documents REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_sales; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.fiscal_documents; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Flag to disable Tiny order push per store (used when emitting NF-e via BrasilNFe directly)
ALTER TABLE public.pos_stores ADD COLUMN IF NOT EXISTS disable_tiny_orders boolean NOT NULL DEFAULT false;
UPDATE public.pos_stores SET disable_tiny_orders = true WHERE name = 'Loja Centro';

-- Public bucket for DANFE PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('fiscal-documents', 'fiscal-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies (public read; service role writes via edge function so no insert policy needed)
DO $$ BEGIN
  CREATE POLICY "Public read fiscal-documents"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'fiscal-documents');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;