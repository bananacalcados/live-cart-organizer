ALTER TABLE public.gateway_refunds ADD COLUMN IF NOT EXISTS receipt_code text, ADD COLUMN IF NOT EXISTS receipt_path text, ADD COLUMN IF NOT EXISTS receipt_generated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS gateway_refunds_receipt_code_uniq ON public.gateway_refunds(receipt_code) WHERE receipt_code IS NOT NULL;
ALTER TABLE public.refund_settings ADD COLUMN IF NOT EXISTS receipt_footer_contact text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION public.refund_config()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT enabled FROM public.refund_settings WHERE id), false),
    'approval_threshold', (SELECT approval_threshold FROM public.refund_settings WHERE id),
    'receipt_footer_contact', COALESCE((SELECT receipt_footer_contact FROM public.refund_settings WHERE id), '')
  )
$$;