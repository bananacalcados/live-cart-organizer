-- 1. Adiciona xml de cancelamento em fiscal_documents
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS cancellation_xml text;

-- 2. Tabela de inutilizações de numeração
CREATE TABLE IF NOT EXISTS public.fiscal_inutilizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  modelo smallint NOT NULL,
  serie smallint NOT NULL,
  numero_inicial bigint NOT NULL,
  numero_final bigint NOT NULL,
  ano smallint NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao','producao')),
  justificativa text NOT NULL CHECK (length(justificativa) >= 15 AND length(justificativa) <= 255),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','error')),
  protocolo text,
  xml_content text,
  rejection_message text,
  brasilnfe_request jsonb,
  brasilnfe_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_faixa CHECK (numero_final >= numero_inicial)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_inut_company ON public.fiscal_inutilizations(company_id, modelo, serie);

ALTER TABLE public.fiscal_inutilizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Inutilizations viewable by authenticated"
  ON public.fiscal_inutilizations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Inutilizations manage by service_role"
  ON public.fiscal_inutilizations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_fiscal_inut_updated
  BEFORE UPDATE ON public.fiscal_inutilizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();