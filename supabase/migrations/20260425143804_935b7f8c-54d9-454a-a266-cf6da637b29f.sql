-- ============================================================
-- 1) Função utilitária: normalizar endereço (CEP + número)
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_address_key(p_cep text, p_number text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    regexp_replace(COALESCE(p_cep, ''), '[^0-9]', '', 'g')
    || '|' ||
    lower(regexp_replace(unaccent(COALESCE(p_number, '')), '[^a-z0-9]', '', 'gi'))
$$;

-- ============================================================
-- 2) Tabela: online_exchanges (trocas de pedidos Shopify)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.online_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pedido de origem (Shopify)
  shopify_order_id text,
  shopify_order_name text NOT NULL,
  shopify_order_number text,
  -- Cliente
  customer_name text,
  customer_email text,
  customer_phone text,
  customer_cpf text,
  -- Item / produto sendo trocado
  product_name text,
  product_sku text,
  product_variant text,
  quantity integer NOT NULL DEFAULT 1,
  -- Motivo da troca (categorias mínimas)
  reason_category text NOT NULL CHECK (reason_category IN ('tamanho','defeito','arrependimento','outros')),
  reason_detail text,
  -- Fluxo
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','in_transit','received','inspected','completed','rejected')),
  received_at timestamptz,
  inspected_at timestamptz,
  completed_at timestamptz,
  -- Auditoria
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_online_exchanges_status ON public.online_exchanges(status);
CREATE INDEX IF NOT EXISTS idx_online_exchanges_reason ON public.online_exchanges(reason_category);
CREATE INDEX IF NOT EXISTS idx_online_exchanges_order ON public.online_exchanges(shopify_order_name);
CREATE INDEX IF NOT EXISTS idx_online_exchanges_created ON public.online_exchanges(created_at DESC);

ALTER TABLE public.online_exchanges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read online_exchanges"
ON public.online_exchanges FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert online_exchanges"
ON public.online_exchanges FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update online_exchanges"
ON public.online_exchanges FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated can delete online_exchanges"
ON public.online_exchanges FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_online_exchanges_updated_at
BEFORE UPDATE ON public.online_exchanges
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3) Tabela: chargebacks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chargebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Origem do pedido contestado
  source text NOT NULL CHECK (source IN ('shopify','pos','expedition_beta','manual')),
  source_order_id text,           -- id externo (shopify order id, pos sale id, etc)
  source_order_name text,         -- ex: "#1234"
  -- Identificação do cliente alvo
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text,
  customer_cpf text,
  -- Endereço (snapshot do momento do chargeback) — usado para match futuro
  address_cep text,
  address_number text,
  address_street text,
  address_neighborhood text,
  address_city text,
  address_state text,
  address_complement text,
  address_key text GENERATED ALWAYS AS (public.normalize_address_key(address_cep, address_number)) STORED,
  -- Dados do chargeback
  amount numeric(10,2),
  chargeback_date date,
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','contacted','resolved','confirmed_fraud','dismissed')),
  contact_notes text,
  -- Auditoria
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chargebacks_status ON public.chargebacks(status);
CREATE INDEX IF NOT EXISTS idx_chargebacks_address_key ON public.chargebacks(address_key) WHERE address_key IS NOT NULL AND address_key <> '|';
CREATE INDEX IF NOT EXISTS idx_chargebacks_phone_suffix ON public.chargebacks((right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 8)));
CREATE INDEX IF NOT EXISTS idx_chargebacks_cpf ON public.chargebacks((regexp_replace(customer_cpf, '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_chargebacks_email ON public.chargebacks(lower(customer_email));
CREATE INDEX IF NOT EXISTS idx_chargebacks_created ON public.chargebacks(created_at DESC);

ALTER TABLE public.chargebacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read chargebacks"
ON public.chargebacks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert chargebacks"
ON public.chargebacks FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update chargebacks"
ON public.chargebacks FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated can delete chargebacks"
ON public.chargebacks FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_chargebacks_updated_at
BEFORE UPDATE ON public.chargebacks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4) Função: avaliar risco de chargeback de um pedido novo
-- ============================================================
-- Retorna jsonb com:
--   { direct_match: [...], address_match: [...] }
-- direct_match: chargebacks do MESMO cliente (cpf/email/telefone)
-- address_match: chargebacks de OUTRO nome no MESMO endereço (suspeita golpe)
CREATE OR REPLACE FUNCTION public.check_chargeback_risk(
  p_customer_name text,
  p_customer_email text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_cpf text DEFAULT NULL,
  p_address_cep text DEFAULT NULL,
  p_address_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_suffix text := right(regexp_replace(COALESCE(p_customer_phone,''), '[^0-9]', '', 'g'), 8);
  v_cpf_norm text := regexp_replace(COALESCE(p_customer_cpf,''), '[^0-9]', '', 'g');
  v_email_norm text := lower(trim(COALESCE(p_customer_email,'')));
  v_addr_key text := public.normalize_address_key(p_address_cep, p_address_number);
  v_name_norm text := lower(trim(COALESCE(p_customer_name,'')));
  v_direct jsonb;
  v_address jsonb;
BEGIN
  -- Match direto: mesmo cliente (CPF, email, ou telefone — qualquer um basta)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_direct
  FROM (
    SELECT id, customer_name, source_order_name, amount, chargeback_date, status, reason
    FROM public.chargebacks
    WHERE
      (v_cpf_norm <> '' AND regexp_replace(COALESCE(customer_cpf,''), '[^0-9]', '', 'g') = v_cpf_norm)
      OR (v_email_norm <> '' AND lower(customer_email) = v_email_norm)
      OR (length(v_phone_suffix) = 8 AND right(regexp_replace(COALESCE(customer_phone,''), '[^0-9]', '', 'g'), 8) = v_phone_suffix)
    ORDER BY created_at DESC
    LIMIT 10
  ) t;

  -- Match por endereço: mesmo CEP+número, NOME DIFERENTE (suspeita de golpe)
  IF v_addr_key <> '|' AND length(v_addr_key) > 1 THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_address
    FROM (
      SELECT id, customer_name, source_order_name, amount, chargeback_date, status, reason,
             address_street, address_number, address_cep
      FROM public.chargebacks
      WHERE address_key = v_addr_key
        AND lower(trim(customer_name)) <> v_name_norm
      ORDER BY created_at DESC
      LIMIT 10
    ) t;
  ELSE
    v_address := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'direct_match', v_direct,
    'address_match', v_address,
    'has_risk', (jsonb_array_length(v_direct) > 0 OR jsonb_array_length(v_address) > 0)
  );
END;
$$;