DROP FUNCTION IF EXISTS public.match_event_leads(uuid, text[]);

CREATE OR REPLACE FUNCTION public.match_event_leads(p_event_id uuid, p_phones text[])
 RETURNS TABLE(phone_key text, this_event boolean, other_event boolean, other_event_name text, other_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH keys AS (
    SELECT DISTINCT public.bc_phone_key(x) AS k
    FROM unnest(COALESCE(p_phones, ARRAY[]::text[])) x
    WHERE public.bc_phone_key(x) <> ''
  )
  SELECT
    k AS phone_key,
    EXISTS (
      SELECT 1 FROM public.event_leads l
      WHERE l.event_id = p_event_id AND public.bc_phone_key(l.phone) = k
    ) AS this_event,
    EXISTS (
      SELECT 1 FROM public.event_leads l
      WHERE l.event_id <> p_event_id AND public.bc_phone_key(l.phone) = k
    ) AS other_event,
    (
      SELECT e.name
      FROM public.event_leads l
      JOIN public.events e ON e.id = l.event_id
      WHERE l.event_id <> p_event_id AND public.bc_phone_key(l.phone) = k
      ORDER BY l.created_at DESC
      LIMIT 1
    ) AS other_event_name,
    (
      SELECT l.source
      FROM public.event_leads l
      WHERE l.event_id <> p_event_id AND public.bc_phone_key(l.phone) = k
      ORDER BY l.created_at DESC
      LIMIT 1
    ) AS other_source
  FROM keys
$function$;