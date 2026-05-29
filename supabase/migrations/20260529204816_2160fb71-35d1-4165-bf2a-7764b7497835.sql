CREATE OR REPLACE FUNCTION public.finalize_completed_dispatches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  WITH done AS (
    SELECT d.id
    FROM public.dispatch_history d
    WHERE d.status = 'sending'
      AND (
        (SELECT count(*) FROM public.dispatch_recipients r0 WHERE r0.dispatch_id = d.id)
          >= COALESCE(d.total_recipients, 0)
        OR d.started_at < now() - interval '15 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.dispatch_recipients r
        WHERE r.dispatch_id = d.id
          AND (
            r.status = 'pending'
            OR (r.status = 'leased' AND (r.lease_until IS NULL OR r.lease_until > now()))
          )
          AND r.attempts < 3
      )
  ),
  agg AS (
    SELECT d.id,
      COUNT(*) FILTER (WHERE r.status IN ('sent','delivered','read'))::int AS sent_count,
      COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed_count
    FROM done d
    JOIN public.dispatch_recipients r ON r.dispatch_id = d.id
    GROUP BY d.id
  )
  UPDATE public.dispatch_history h
  SET status = 'completed',
      completed_at = now(),
      processing_batch = false,
      sent_count = a.sent_count,
      failed_count = a.failed_count
  FROM agg a
  WHERE h.id = a.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_dispatch_sent(p_ids uuid[], p_wamids text[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.dispatch_recipients r
  SET status = 'sent',
      message_wamid = v.wamid,
      sent_at = now(),
      lease_until = null
  FROM (SELECT unnest(p_ids) AS id, unnest(p_wamids) AS wamid) v
  WHERE r.id = v.id;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_completed_dispatches() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dispatch_sent(uuid[], text[]) TO service_role, authenticated;