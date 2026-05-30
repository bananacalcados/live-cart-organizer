CREATE OR REPLACE FUNCTION public.refresh_dispatch_counts(p_dispatch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.dispatch_history h
  SET sent_count = GREATEST(COALESCE(h.sent_count, 0), a.sent_count),
      failed_count = GREATEST(COALESCE(h.failed_count, 0), a.failed_count)
  FROM (
    SELECT
      count(*) FILTER (WHERE status IN ('sent','delivered','read'))::int AS sent_count,
      count(*) FILTER (WHERE status = 'failed')::int AS failed_count
    FROM public.dispatch_recipients
    WHERE dispatch_id = p_dispatch_id
  ) a
  WHERE h.id = p_dispatch_id;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_dispatch_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_dispatch_counts(uuid) TO authenticated;