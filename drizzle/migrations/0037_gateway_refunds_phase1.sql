CREATE TABLE public.gateway_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL DEFAULT 'mercadopago',
  source TEXT NOT NULL CHECK (source IN ('order','pos_sale')),
  source_id UUID NOT NULL,
  mp_account_id UUID NULL,
  payment_id TEXT NOT NULL,
  refund_id TEXT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  refund_type TEXT NOT NULL CHECK (refund_type IN ('integral','parcial')),
  reason TEXT NOT NULL,
  reason_text TEXT NULL,
  status TEXT NOT NULL DEFAULT 'aguardando_aprovacao' CHECK (status IN ('aguardando_aprovacao','recusado','processando','concluido','falhou')),
  idempotency_key TEXT NOT NULL UNIQUE,
  e2e_id TEXT NULL,
  card_brand TEXT NULL,
  card_last4 TEXT NULL,
  installments INTEGER NULL,
  mp_response JSONB NULL,
  error_message TEXT NULL,
  requested_by UUID NULL,
  approved_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX gateway_refunds_source_idx ON public.gateway_refunds (source, source_id);
CREATE INDEX gateway_refunds_payment_idx ON public.gateway_refunds (payment_id);
CREATE INDEX gateway_refunds_status_idx ON public.gateway_refunds (status) WHERE status IN ('aguardando_aprovacao','processando');

GRANT SELECT ON public.gateway_refunds TO authenticated;
GRANT ALL ON public.gateway_refunds TO service_role;

ALTER TABLE public.gateway_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins e permissao estornos leem estornos"
ON public.gateway_refunds
FOR SELECT
TO authenticated
USING (public.has_module_access(auth.uid(), 'estornos'));

ALTER TABLE public.trocas_devolucoes ADD COLUMN gateway_refund_id UUID NULL;
COMMENT ON COLUMN public.trocas_devolucoes.gateway_refund_id IS 'Estorno em gateway_refunds vinculado a esta troca/devolucao (Fase 1: Mercado Pago).';

CREATE OR REPLACE FUNCTION public.refund_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT value #>> '{}' FROM public.app_settings WHERE key = 'refunds_enabled'), 'false')::boolean,
    'approval_threshold', (SELECT CASE WHEN value IS NULL OR value = 'null'::jsonb THEN NULL ELSE (value #>> '{}')::numeric END FROM public.app_settings WHERE key = 'refund_approval_threshold')
  )
$$;

GRANT EXECUTE ON FUNCTION public.refund_config() TO authenticated;