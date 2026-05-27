
INSERT INTO storage.buckets (id, name, public) VALUES ('financial-receipts', 'financial-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins read financial receipts" ON storage.objects;
CREATE POLICY "Admins read financial receipts" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'financial-receipts' AND public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.financial_agent_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id text NOT NULL,
  telegram_message_id bigint,
  telegram_file_id text,
  mime_type text,
  storage_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','extracted','duplicate','linked','failed','ignored')),
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_model text,
  ai_raw text,
  cash_flow_entry_id uuid REFERENCES public.cash_flow_entries(id) ON DELETE SET NULL,
  duplicate_of uuid REFERENCES public.cash_flow_entries(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_agent_receipts TO authenticated;
GRANT ALL ON public.financial_agent_receipts TO service_role;

ALTER TABLE public.financial_agent_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage agent receipts" ON public.financial_agent_receipts;
CREATE POLICY "Admins manage agent receipts" ON public.financial_agent_receipts
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_fa_receipts_chat ON public.financial_agent_receipts (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_receipts_status ON public.financial_agent_receipts (status);

DROP TRIGGER IF EXISTS trg_fa_receipts_updated ON public.financial_agent_receipts;
CREATE TRIGGER trg_fa_receipts_updated BEFORE UPDATE ON public.financial_agent_receipts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
