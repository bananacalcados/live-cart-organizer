-- =========================================================================
-- FASE 2A: fiscal_operations + resolve_fiscal_rule
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.fiscal_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ncm TEXT,
  uf_origem TEXT NOT NULL,
  uf_destino TEXT,
  tipo_operacao TEXT NOT NULL DEFAULT 'venda',
  cfop TEXT NOT NULL,
  cst_icms TEXT,
  csosn_icms TEXT,
  aliq_icms NUMERIC(5,2) DEFAULT 0,
  cst_pis TEXT NOT NULL DEFAULT '49',
  aliq_pis NUMERIC(5,2) DEFAULT 0,
  cst_cofins TEXT NOT NULL DEFAULT '49',
  aliq_cofins NUMERIC(5,2) DEFAULT 0,
  origem_mercadoria SMALLINT NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tipo_operacao IN ('venda','devolucao','transferencia')),
  CHECK (origem_mercadoria BETWEEN 0 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_ops_lookup ON public.fiscal_operations (uf_origem, tipo_operacao, ncm, uf_destino, is_active);

ALTER TABLE public.fiscal_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage fiscal_operations" ON public.fiscal_operations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_fiscal_operations_updated
  BEFORE UPDATE ON public.fiscal_operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.resolve_fiscal_rule(
  p_ncm TEXT,
  p_uf_origem TEXT,
  p_uf_destino TEXT,
  p_tipo_operacao TEXT DEFAULT 'venda'
) RETURNS public.fiscal_operations
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.fiscal_operations;
BEGIN
  -- 1. Match exato (NCM + UF destino)
  SELECT * INTO v_row FROM public.fiscal_operations
  WHERE is_active AND tipo_operacao = p_tipo_operacao
    AND uf_origem = p_uf_origem AND ncm = p_ncm AND uf_destino = p_uf_destino
  ORDER BY priority DESC LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  -- 2. NCM + UF destino qualquer
  SELECT * INTO v_row FROM public.fiscal_operations
  WHERE is_active AND tipo_operacao = p_tipo_operacao
    AND uf_origem = p_uf_origem AND ncm = p_ncm AND uf_destino IS NULL
  ORDER BY priority DESC LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  -- 3. Qualquer NCM + UF destino exato
  SELECT * INTO v_row FROM public.fiscal_operations
  WHERE is_active AND tipo_operacao = p_tipo_operacao
    AND uf_origem = p_uf_origem AND ncm IS NULL AND uf_destino = p_uf_destino
  ORDER BY priority DESC LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  -- 4. Fallback geral (qualquer NCM, qualquer UF)
  SELECT * INTO v_row FROM public.fiscal_operations
  WHERE is_active AND tipo_operacao = p_tipo_operacao
    AND uf_origem = p_uf_origem AND ncm IS NULL AND uf_destino IS NULL
  ORDER BY priority DESC LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  RAISE EXCEPTION 'Nenhuma regra fiscal encontrada para NCM=% UF=%/% op=%', p_ncm, p_uf_origem, p_uf_destino, p_tipo_operacao;
END;
$$;

-- =========================================================================
-- FASE 2B: Snapshot fiscal em pos_sale_items
-- =========================================================================
ALTER TABLE public.pos_sale_items
  ADD COLUMN IF NOT EXISTS ncm_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS cfop_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS cst_icms TEXT,
  ADD COLUMN IF NOT EXISTS csosn_icms TEXT,
  ADD COLUMN IF NOT EXISTS aliq_icms NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS cst_pis TEXT,
  ADD COLUMN IF NOT EXISTS aliq_pis NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS cst_cofins TEXT,
  ADD COLUMN IF NOT EXISTS aliq_cofins NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS origem_mercadoria SMALLINT,
  ADD COLUMN IF NOT EXISTS cest_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS unidade_comercial TEXT;

-- =========================================================================
-- FASE 3A (base): fiscal_documents
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.fiscal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  pos_sale_id UUID REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  order_id UUID,
  modelo SMALLINT NOT NULL,
  serie SMALLINT NOT NULL,
  numero BIGINT NOT NULL,
  ambiente TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chave_acesso TEXT UNIQUE,
  protocolo TEXT,
  data_autorizacao TIMESTAMPTZ,
  xml_url TEXT,
  xml_content TEXT,
  danfe_url TEXT,
  qrcode_url TEXT,
  valor_total NUMERIC(12,2),
  cpf_destinatario TEXT,
  nome_destinatario TEXT,
  rejection_code TEXT,
  rejection_message TEXT,
  cancellation_protocol TEXT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  brasilnfe_request JSONB,
  brasilnfe_response JSONB,
  events JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (modelo IN (55, 65)),
  CHECK (ambiente IN ('producao','homologacao')),
  CHECK (status IN ('pending','sent','authorized','rejected','cancelled','denied','error'))
);

CREATE INDEX IF NOT EXISTS idx_fiscal_docs_company ON public.fiscal_documents(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_sale ON public.fiscal_documents(pos_sale_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_status ON public.fiscal_documents(status);

ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage fiscal_documents" ON public.fiscal_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_fiscal_documents_updated
  BEFORE UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();