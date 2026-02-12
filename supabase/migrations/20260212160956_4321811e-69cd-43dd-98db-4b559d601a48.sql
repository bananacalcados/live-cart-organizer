
-- Table for synced accounts payable from Tiny ERP
CREATE TABLE public.tiny_accounts_payable (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  tiny_conta_id TEXT NOT NULL,
  nome_fornecedor TEXT,
  numero_doc TEXT,
  data_vencimento DATE,
  data_emissao DATE,
  data_pagamento DATE,
  valor NUMERIC DEFAULT 0,
  valor_pago NUMERIC DEFAULT 0,
  saldo NUMERIC DEFAULT 0,
  situacao TEXT, -- aberto, pago, parcial, cancelado
  observacoes TEXT,
  historico TEXT,
  categoria TEXT,
  competencia TEXT,
  nro_banco TEXT,
  raw_data JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, tiny_conta_id)
);

-- Enable RLS
ALTER TABLE public.tiny_accounts_payable ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read accounts payable"
  ON public.tiny_accounts_payable FOR SELECT
  TO authenticated USING (true);

-- Allow service role to manage (edge functions)
CREATE POLICY "Service role can manage accounts payable"
  ON public.tiny_accounts_payable FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Sync log support
CREATE TABLE public.tiny_accounts_payable_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES public.pos_stores(id),
  status TEXT NOT NULL DEFAULT 'running',
  total_synced INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.tiny_accounts_payable_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read AP sync log"
  ON public.tiny_accounts_payable_sync_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role can manage AP sync log"
  ON public.tiny_accounts_payable_sync_log FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Index for common queries
CREATE INDEX idx_tiny_ap_store_vencimento ON public.tiny_accounts_payable(store_id, data_vencimento);
CREATE INDEX idx_tiny_ap_situacao ON public.tiny_accounts_payable(situacao);

-- Trigger for updated_at
CREATE TRIGGER update_tiny_accounts_payable_updated_at
  BEFORE UPDATE ON public.tiny_accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
