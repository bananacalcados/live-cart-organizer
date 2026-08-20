CREATE INDEX IF NOT EXISTS idx_event_leads_phone_key ON public.event_leads (public.bc_phone_key(phone));

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
  ),
  lk AS (
    SELECT public.bc_phone_key(l.phone) AS k, l.event_id, l.created_at, l.source
    FROM public.event_leads l
    WHERE public.bc_phone_key(l.phone) IN (SELECT k FROM keys)
  )
  SELECT
    k.k AS phone_key,
    COALESCE(bool_or(lk.event_id = p_event_id), false) AS this_event,
    COALESCE(bool_or(lk.event_id <> p_event_id), false) AS other_event,
    (array_agg(e.name ORDER BY lk.created_at DESC)
       FILTER (WHERE lk.event_id IS NOT NULL AND lk.event_id <> p_event_id))[1] AS other_event_name,
    (array_agg(lk.source ORDER BY lk.created_at DESC)
       FILTER (WHERE lk.event_id IS NOT NULL AND lk.event_id <> p_event_id))[1] AS other_source
  FROM keys k
  LEFT JOIN lk ON lk.k = k.k
  LEFT JOIN public.events e ON e.id = lk.event_id
  GROUP BY k.k
$function$;