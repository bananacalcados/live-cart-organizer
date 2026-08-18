CREATE OR REPLACE FUNCTION public.get_automation_dispatch_stats()
RETURNS TABLE (flow_id uuid, sent bigint, failed bigint, skipped bigint, last_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT ads.flow_id,
           COUNT(*) FILTER (WHERE COALESCE(ads.status,'sent') NOT IN ('failed','blocked')) AS sent,
           COUNT(*) FILTER (WHERE ads.status = 'failed') AS failed,
           MAX(ads.sent_at) AS last_at
    FROM public.automation_dispatch_sent ads
    WHERE ads.flow_id IS NOT NULL
    GROUP BY ads.flow_id
  ), j AS (
    SELECT adj.flow_id, SUM(COALESCE(adj.skipped,0))::bigint AS skipped
    FROM public.automation_dispatch_jobs adj
    WHERE adj.flow_id IS NOT NULL
    GROUP BY adj.flow_id
  )
  SELECT COALESCE(s.flow_id, j.flow_id),
         COALESCE(s.sent,0)::bigint,
         COALESCE(s.failed,0)::bigint,
         COALESCE(j.skipped,0)::bigint,
         s.last_at
  FROM s FULL OUTER JOIN j ON j.flow_id = s.flow_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_automation_dispatch_stats() TO authenticated, service_role;