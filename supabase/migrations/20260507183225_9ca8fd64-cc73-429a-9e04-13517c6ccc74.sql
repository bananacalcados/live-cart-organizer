-- Enum regime tributário
DO $$ BEGIN
  CREATE TYPE public.regime_tributario AS ENUM ('simples_nacional', 'lucro_presumido', 'lucro_real', 'mei');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ambiente_nfe AS ENUM ('homologacao', 'producao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela companies (entidade fiscal por CNPJ)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  cnpj TEXT NOT NULL UNIQUE,
  ie TEXT,
  ie_isento BOOLEAN NOT NULL DEFAULT false,
  im TEXT,
  regime_tributario public.regime_tributario NOT NULL DEFAULT 'simples_nacional',
  crt SMALLINT NOT NULL DEFAULT 1, -- 1=Simples, 2=Simples excesso, 3=Regime normal
  cnae_principal TEXT,

  -- Endereço fiscal
  address_cep TEXT,
  address_street TEXT,
  address_number TEXT,
  address_complement TEXT,
  address_neighborhood TEXT,
  address_city TEXT,
  address_city_ibge TEXT,
  address_state TEXT,
  address_country TEXT NOT NULL DEFAULT 'Brasil',

  -- Contato
  email TEXT,
  phone TEXT,

  -- Configuração NFe
  ambiente_nfe public.ambiente_nfe NOT NULL DEFAULT 'homologacao',
  brasilnfe_token TEXT, -- token API BrasilNFe (criptografado/futuro vault)
  certificate_uploaded_at TIMESTAMPTZ, -- quando o A1 foi anexado
  certificate_expires_at TIMESTAMPTZ,

  -- Controle interno
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_pilot BOOLEAN NOT NULL DEFAULT false, -- true = CNPJ Novo, primeiro a migrar
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_active ON public.companies(is_active);
CREATE INDEX IF NOT EXISTS idx_companies_cnpj ON public.companies(cnpj);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: apenas admins
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage companies" ON public.companies;
CREATE POLICY "Admins manage companies" ON public.companies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Adicionar company_id em pos_stores
ALTER TABLE public.pos_stores
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_stores_company ON public.pos_stores(company_id);