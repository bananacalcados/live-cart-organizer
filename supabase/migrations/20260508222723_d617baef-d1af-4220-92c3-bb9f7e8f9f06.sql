
CREATE TABLE public.nfe_received (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chave_acesso text NOT NULL UNIQUE,
  numero bigint,
  serie smallint,
  modelo smallint DEFAULT 55,
  emitente_cnpj text,
  emitente_nome text,
  emitente_uf text,
  destinatario_cnpj text,
  valor_total numeric(14,2),
  data_emissao timestamptz,
  natureza_operacao text,
  tipo_operacao smallint,
  manifestacao_status text NOT NULL DEFAULT 'pendente',
  manifestacao_data timestamptz,
  manifestacao_protocolo text,
  manifestacao_justificativa text,
  estoque_status text NOT NULL DEFAULT 'nao_lancado',
  estoque_lancado_em timestamptz,
  estoque_lancado_por uuid,
  xml_resumo_content text,
  xml_completo_content text,
  xml_url text,
  danfe_url text,
  brasilnfe_response jsonb,
  nsu text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfe_received_company ON public.nfe_received(company_id);
CREATE INDEX idx_nfe_received_manifestacao ON public.nfe_received(manifestacao_status);
CREATE INDEX idx_nfe_received_estoque ON public.nfe_received(estoque_status);
CREATE INDEX idx_nfe_received_data ON public.nfe_received(data_emissao DESC);

ALTER TABLE public.nfe_received ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read nfe_received" ON public.nfe_received
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins manage nfe_received" ON public.nfe_received
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_nfe_received_updated_at
  BEFORE UPDATE ON public.nfe_received
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.nfe_received_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_received_id uuid NOT NULL REFERENCES public.nfe_received(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text NOT NULL,
  protocolo text,
  justificativa text,
  request_payload jsonb,
  response_payload jsonb,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfe_received_events_nfe ON public.nfe_received_events(nfe_received_id);

ALTER TABLE public.nfe_received_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read nfe_received_events" ON public.nfe_received_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert nfe_received_events" ON public.nfe_received_events
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.nfe_distribuicao_state (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  ultimo_nsu text NOT NULL DEFAULT '0',
  max_nsu text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nfe_distribuicao_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage distribuicao_state" ON public.nfe_distribuicao_state
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_distribuicao_state_updated
  BEFORE UPDATE ON public.nfe_distribuicao_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
