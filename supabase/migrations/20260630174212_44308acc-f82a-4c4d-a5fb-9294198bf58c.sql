CREATE OR REPLACE FUNCTION public.set_event_live_active(p_event_id uuid)
  RETURNS timestamp with time zone
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_until timestamptz := now() + interval '12 hours';
BEGIN
  UPDATE public.events
    SET live_active_until = NULL
    WHERE live_active_until IS NOT NULL
      AND id <> p_event_id;

  UPDATE public.events
    SET live_active_until = v_until
    WHERE id = p_event_id;

  RETURN v_until;
END;
$function$;