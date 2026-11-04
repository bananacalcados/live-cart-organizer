CREATE TABLE public.correios_reverse_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  phone_key text GENERATED ALWAYS AS (right(regexp_replace(customer_phone, '\D', '', 'g'), 8)) STORED,
  customer_cpf text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  sale_id uuid,
  reason text,
  servico_codigo text NOT NULL,
  servico_nome text,
  package jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_until date,
  status text NOT NULL DEFAULT 'criada' CHECK (status IN ('criada','rotulo_emitido','postada','entregue','cancelada','erro')),
  prepostagem_id text,
  codigo_objeto text,
  label_path text,
  request jsonb,
  response jsonb,
  error_message text,
  sent_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX correios_reverse_phone_idx ON public.correios_reverse_shipments (phone_key, created_at DESC);
GRANT SELECT ON public.correios_reverse_shipments TO authenticated;
GRANT ALL ON public.correios_reverse_shipments TO service_role;
ALTER TABLE public.correios_reverse_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read reverse shipments" ON public.correios_reverse_shipments FOR SELECT TO authenticated USING (true);