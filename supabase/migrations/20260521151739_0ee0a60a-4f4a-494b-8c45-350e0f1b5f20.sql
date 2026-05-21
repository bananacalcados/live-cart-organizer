
-- =====================================================
-- FASE 1: Unificação de Clientes — Estrutura base
-- =====================================================

-- 1) Função auxiliar: extrai os últimos 8 dígitos do telefone
CREATE OR REPLACE FUNCTION public.extract_phone_suffix8(phone_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF phone_input IS NULL THEN
    RETURN NULL;
  END IF;
  digits := regexp_replace(phone_input, '\D', '', 'g');
  IF length(digits) < 8 THEN
    RETURN NULL;
  END IF;
  RETURN right(digits, 8);
END;
$$;

-- 2) Sequência para o código humano BC-XXXXXX
CREATE SEQUENCE IF NOT EXISTS public.customer_code_seq START WITH 1 INCREMENT BY 1;

-- 3) Função que formata o código sequencial (BC-000001)
CREATE OR REPLACE FUNCTION public.format_customer_code(seq_val BIGINT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'BC-' || lpad(seq_val::TEXT, 6, '0');
$$;

-- 4) Tabela mestre unificada
CREATE TABLE public.customers_unified (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_code TEXT UNIQUE,
  tenant_id UUID,

  -- Identidade
  name TEXT,
  cpf TEXT,
  email TEXT,
  birth_date DATE,
  gender TEXT,

  -- Contato
  phone_e164 TEXT,
  phone_suffix8 TEXT,
  previous_phones TEXT[] DEFAULT ARRAY[]::TEXT[],
  instagram_handle TEXT,
  instagram_user_id TEXT,

  -- Endereço
  cep TEXT,
  address TEXT,
  address_number TEXT,
  complement TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,

  -- Perfil comercial
  shoe_size TEXT,
  preferred_style TEXT,
  age_range TEXT,
  has_children BOOLEAN DEFAULT false,
  children_age_range TEXT,

  -- Métricas pré-calculadas (atualizadas por triggers em orders/pos_sales)
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_ticket NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  first_purchase_at TIMESTAMPTZ,
  last_purchase_at TIMESTAMPTZ,

  -- Segmentação
  rfm_segment TEXT,
  rfm_r INTEGER,
  rfm_f INTEGER,
  rfm_m INTEGER,
  rfm_total INTEGER,
  region_type TEXT,
  ddd TEXT,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],

  -- Status
  is_banned BOOLEAN NOT NULL DEFAULT false,
  ban_reason TEXT,
  live_cancellation_count INTEGER NOT NULL DEFAULT 0,

  -- Auditoria / origem
  source_origins JSONB DEFAULT '[]'::JSONB,
  metadata JSONB DEFAULT '{}'::JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

-- 5) Índices para lookup rápido
CREATE UNIQUE INDEX customers_unified_cpf_uniq
  ON public.customers_unified (cpf)
  WHERE cpf IS NOT NULL AND cpf <> '';

CREATE INDEX customers_unified_phone_e164_idx
  ON public.customers_unified (phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX customers_unified_phone_suffix8_idx
  ON public.customers_unified (phone_suffix8)
  WHERE phone_suffix8 IS NOT NULL;

CREATE INDEX customers_unified_email_idx
  ON public.customers_unified (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX customers_unified_instagram_idx
  ON public.customers_unified (lower(instagram_handle))
  WHERE instagram_handle IS NOT NULL;

CREATE INDEX customers_unified_tenant_idx
  ON public.customers_unified (tenant_id);

CREATE INDEX customers_unified_last_purchase_idx
  ON public.customers_unified (last_purchase_at DESC NULLS LAST);

CREATE INDEX customers_unified_rfm_idx
  ON public.customers_unified (rfm_segment) WHERE rfm_segment IS NOT NULL;

-- 6) Trigger: gera customer_code automaticamente e mantém phone_suffix8 sincronizado
CREATE OR REPLACE FUNCTION public.customers_unified_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Sincroniza phone_suffix8 com phone_e164
  IF NEW.phone_e164 IS NOT NULL THEN
    NEW.phone_suffix8 := public.extract_phone_suffix8(NEW.phone_e164);
  ELSE
    NEW.phone_suffix8 := NULL;
  END IF;

  -- Atualiza updated_at em UPDATE
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  -- Gera customer_code em INSERT
  IF TG_OP = 'INSERT' AND NEW.customer_code IS NULL THEN
    NEW.customer_code := public.format_customer_code(nextval('public.customer_code_seq'));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_unified_before_write_trg
BEFORE INSERT OR UPDATE ON public.customers_unified
FOR EACH ROW
EXECUTE FUNCTION public.customers_unified_before_write();

-- 7) Tabela de vínculo com listas de marketing
CREATE TABLE public.customer_list_memberships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers_unified(id) ON DELETE CASCADE,
  list_id UUID NOT NULL,
  source TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, list_id)
);

CREATE INDEX customer_list_memberships_list_idx
  ON public.customer_list_memberships (list_id);
CREATE INDEX customer_list_memberships_customer_idx
  ON public.customer_list_memberships (customer_id);

-- 8) RLS
ALTER TABLE public.customers_unified ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_list_memberships ENABLE ROW LEVEL SECURITY;

-- Authenticated: leitura/escrita ampla (mesma regra prática da tabela `customers` atual)
CREATE POLICY "authenticated can read customers_unified"
  ON public.customers_unified FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can insert customers_unified"
  ON public.customers_unified FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated can update customers_unified"
  ON public.customers_unified FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can delete customers_unified"
  ON public.customers_unified FOR DELETE
  TO authenticated USING (true);

CREATE POLICY "authenticated can read memberships"
  ON public.customer_list_memberships FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can write memberships"
  ON public.customer_list_memberships FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
