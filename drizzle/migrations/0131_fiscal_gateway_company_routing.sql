CREATE TABLE public.fiscal_gateway_company_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  emit_by_gateway boolean NOT NULL DEFAULT false,
  default_company_id uuid NOT NULL REFERENCES public.companies(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, UPDATE ON public.fiscal_gateway_company_config TO authenticated;
GRANT ALL ON public.fiscal_gateway_company_config TO service_role;
REVOKE ALL ON public.fiscal_gateway_company_config FROM anon;
ALTER TABLE public.fiscal_gateway_company_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read fiscal gateway company config"
ON public.fiscal_gateway_company_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update fiscal gateway company config"
ON public.fiscal_gateway_company_config FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fiscal_gateway_company_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_gateway_company_map TO authenticated;
GRANT ALL ON public.fiscal_gateway_company_map TO service_role;
REVOKE ALL ON public.fiscal_gateway_company_map FROM anon;
ALTER TABLE public.fiscal_gateway_company_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read fiscal gateway company map"
ON public.fiscal_gateway_company_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert fiscal gateway company map"
ON public.fiscal_gateway_company_map FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update fiscal gateway company map"
ON public.fiscal_gateway_company_map FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete fiscal gateway company map"
ON public.fiscal_gateway_company_map FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fiscal_emission_pendings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('pos_sale', 'order')),
  source_id uuid NOT NULL,
  reason text NOT NULL,
  gateways text[] NOT NULL DEFAULT '{}',
  company_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (source_type, source_id)
);
CREATE INDEX fiscal_emission_pendings_open_created_idx
ON public.fiscal_emission_pendings (created_at DESC) WHERE status = 'open';
GRANT SELECT ON public.fiscal_emission_pendings TO authenticated;
GRANT ALL ON public.fiscal_emission_pendings TO service_role;
REVOKE ALL ON public.fiscal_emission_pendings FROM anon;
ALTER TABLE public.fiscal_emission_pendings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read fiscal emission pendings"
ON public.fiscal_emission_pendings FOR SELECT TO authenticated USING (true);

ALTER TABLE public.fiscal_documents
  ADD COLUMN company_selection_rule text,
  ADD COLUMN company_selection_gateway text,
  ADD COLUMN company_selection_details jsonb;
COMMENT ON COLUMN public.fiscal_documents.company_selection_rule IS 'Regra que escolheu o emissor: gateway_mapped, default_gateway, store, manual_split ou legacy.';
COMMENT ON COLUMN public.fiscal_documents.company_selection_gateway IS 'Gateway(s) usado(s) na escolha do CNPJ emissor.';
COMMENT ON COLUMN public.fiscal_documents.company_selection_details IS 'Evidências da escolha do emissor, sem credenciais.';