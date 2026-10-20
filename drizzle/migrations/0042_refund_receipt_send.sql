ALTER TABLE public.gateway_refunds
  ADD COLUMN IF NOT EXISTS receipt_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_sent_by uuid,
  ADD COLUMN IF NOT EXISTS receipt_sent_to text,
  ADD COLUMN IF NOT EXISTS receipt_sent_channel text;
ALTER TABLE public.refund_settings
  ADD COLUMN IF NOT EXISTS receipt_message_template text;
CREATE OR REPLACE FUNCTION public.refund_config()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT enabled FROM public.refund_settings WHERE id), false),
    'approval_threshold', (SELECT approval_threshold FROM public.refund_settings WHERE id),
    'receipt_footer_contact', COALESCE((SELECT receipt_footer_contact FROM public.refund_settings WHERE id), ''),
    'receipt_message_template', COALESCE((SELECT receipt_message_template FROM public.refund_settings WHERE id), '')
  )
$function$;