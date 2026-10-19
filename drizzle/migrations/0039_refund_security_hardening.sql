-- 1) Configuração de estornos em tabela própria (escrita só via service role)
CREATE TABLE public.refund_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  approval_threshold numeric(12,2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.refund_settings TO authenticated;
GRANT ALL ON public.refund_settings TO service_role;

ALTER TABLE public.refund_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins e operadores de estorno leem refund_settings"
ON public.refund_settings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'estornos'));

-- Migra os valores atuais de app_settings (se existirem) e remove as chaves antigas
INSERT INTO public.refund_settings (id, enabled, approval_threshold)
SELECT true,
  COALESCE((SELECT (value #>> '{}')::boolean FROM public.app_settings WHERE key = 'refunds_enabled'), false),
  (SELECT CASE WHEN value IS NULL OR value = 'null'::jsonb THEN NULL ELSE (value #>> '{}')::numeric END FROM public.app_settings WHERE key = 'refund_approval_threshold')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.app_settings WHERE key IN ('refunds_enabled', 'refund_approval_threshold');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.refund_settings FROM anon, authenticated;
REVOKE ALL ON public.refund_settings FROM anon;

-- 2) gateway_refunds: novo status 'verificar' + trava única de um estorno em andamento por pagamento
ALTER TABLE public.gateway_refunds DROP CONSTRAINT gateway_refunds_status_check;
ALTER TABLE public.gateway_refunds ADD CONSTRAINT gateway_refunds_status_check
  CHECK (status = ANY (ARRAY['aguardando_aprovacao','recusado','processando','verificar','concluido','falhou']));

CREATE UNIQUE INDEX gateway_refunds_one_in_flight_per_payment
  ON public.gateway_refunds (payment_id)
  WHERE status IN ('aguardando_aprovacao','processando','verificar');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.gateway_refunds FROM anon, authenticated;
REVOKE ALL ON public.gateway_refunds FROM anon;

-- 3) refund_config() passa a ler da nova tabela
CREATE OR REPLACE FUNCTION public.refund_config()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT enabled FROM public.refund_settings WHERE id), false),
    'approval_threshold', (SELECT approval_threshold FROM public.refund_settings WHERE id)
  )
$function$;