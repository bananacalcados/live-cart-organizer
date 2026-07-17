
ALTER TYPE public.td_status ADD VALUE IF NOT EXISTS 'aguardando_envio' BEFORE 'concluida';

ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS tracking_carrier TEXT;

ALTER TABLE public.trocas_devolucoes
  ADD COLUMN IF NOT EXISTS nfe_reposicao_id UUID REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_code TEXT,
  ADD COLUMN IF NOT EXISTS tracking_carrier TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_notification_sent_at TIMESTAMPTZ;
