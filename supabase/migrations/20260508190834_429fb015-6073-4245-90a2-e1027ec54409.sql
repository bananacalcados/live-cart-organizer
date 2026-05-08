ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contingencia_motivo TEXT;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_pending_sefaz
  ON public.fiscal_documents (status, next_retry_at)
  WHERE status = 'pending_sefaz';