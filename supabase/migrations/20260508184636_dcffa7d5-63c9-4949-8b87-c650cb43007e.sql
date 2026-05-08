CREATE TABLE IF NOT EXISTS public.fiscal_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'brasilnfe',
  event_type text,
  chave_acesso text,
  identificador_interno text,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fwe_chave ON public.fiscal_webhook_events(chave_acesso);
CREATE INDEX IF NOT EXISTS idx_fwe_ident ON public.fiscal_webhook_events(identificador_interno);
CREATE INDEX IF NOT EXISTS idx_fwe_doc ON public.fiscal_webhook_events(fiscal_document_id);
CREATE INDEX IF NOT EXISTS idx_fwe_received ON public.fiscal_webhook_events(received_at DESC);

ALTER TABLE public.fiscal_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read fiscal webhook events"
  ON public.fiscal_webhook_events FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));