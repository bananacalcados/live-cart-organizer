CREATE OR REPLACE FUNCTION public.get_event_installment_config(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'installment_min_value', e.installment_min_value,
    'installment_max', e.installment_max
  )
  FROM events e
  WHERE e.id = p_event_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_event_installment_config(uuid) TO anon, authenticated;