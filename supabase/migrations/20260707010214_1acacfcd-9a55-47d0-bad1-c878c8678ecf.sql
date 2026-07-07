-- Fase 5 — NF-e de devolução (entrada) + integridade transacional da Etapa 2

-- 1) fiscal_documents: distinguir entrada/saída, finalidade e nota referenciada
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS finalidade smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tipo_operacao text NOT NULL DEFAULT 'saida',
  ADD COLUMN IF NOT EXISTS ref_chave_acesso text,
  ADD COLUMN IF NOT EXISTS troca_devolucao_id uuid REFERENCES public.trocas_devolucoes(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_tipo_operacao_check'
  ) THEN
    ALTER TABLE public.fiscal_documents
      ADD CONSTRAINT fiscal_documents_tipo_operacao_check
      CHECK (tipo_operacao = ANY (ARRAY['entrada'::text, 'saida'::text]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fiscal_docs_troca ON public.fiscal_documents(troca_devolucao_id);

-- Corrige o CHECK de status para permitir 'pending_sefaz' (contingência) — as edge
-- functions já escrevem esse valor, mas o constraint atual o rejeita silenciosamente.
ALTER TABLE public.fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_status_check;
ALTER TABLE public.fiscal_documents
  ADD CONSTRAINT fiscal_documents_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text, 'sent'::text, 'authorized'::text, 'rejected'::text,
    'cancelled'::text, 'denied'::text, 'error'::text, 'pending_sefaz'::text
  ]));

-- 2) trocas_devolucoes: estado intermediário para reprocessar apenas a etapa que falhou
ALTER TABLE public.trocas_devolucoes
  ADD COLUMN IF NOT EXISTS devolucao_doc_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS venda_nova_doc_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estoque_movimentado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pedido_ajustado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fase2_erro text;