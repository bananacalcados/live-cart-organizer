ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS public_catalog_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_catalog_until timestamptz;

CREATE TABLE public.public_catalog_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('open','view','checkout','order')),
  catalog_product_id uuid,
  order_id uuid,
  group_id uuid,
  utm_source text,
  utm_campaign text,
  dispatch_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_public_catalog_visits_event ON public.public_catalog_visits (event_id, created_at DESC);

REVOKE ALL ON public.public_catalog_visits FROM anon, PUBLIC;
GRANT SELECT ON public.public_catalog_visits TO authenticated;
GRANT ALL ON public.public_catalog_visits TO service_role;
ALTER TABLE public.public_catalog_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read public catalog visits" ON public.public_catalog_visits
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.public_catalog_report(p_event_id uuid)
RETURNS TABLE(group_id uuid, group_name text, utm_campaign text, opens bigint, views bigint, orders bigint, paid bigint, paid_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH v AS (
    SELECT * FROM public.public_catalog_visits WHERE event_id = p_event_id
  ), o AS (
    SELECT DISTINCT ON (v.order_id) v.order_id, v.group_id, v.utm_campaign FROM v WHERE v.kind = 'order' AND v.order_id IS NOT NULL ORDER BY v.order_id, v.created_at
  ), agg AS (
    SELECT v.group_id, v.utm_campaign,
      count(*) FILTER (WHERE kind='open') AS opens,
      count(*) FILTER (WHERE kind='view') AS views
    FROM v GROUP BY 1,2
  ), ord AS (
    SELECT o.group_id, o.utm_campaign, count(*) AS orders,
      count(*) FILTER (WHERE od.is_paid OR od.paid_externally) AS paid,
      coalesce(sum(coalesce(od.gateway_amount,0)) FILTER (WHERE od.is_paid OR od.paid_externally),0) AS paid_value
    FROM o JOIN public.orders od ON od.id = o.order_id GROUP BY 1,2
  )
  SELECT coalesce(a.group_id, r.group_id), g.name, coalesce(a.utm_campaign, r.utm_campaign),
    coalesce(a.opens,0), coalesce(a.views,0), coalesce(r.orders,0), coalesce(r.paid,0), coalesce(r.paid_value,0)
  FROM agg a FULL JOIN ord r ON r.group_id IS NOT DISTINCT FROM a.group_id AND r.utm_campaign IS NOT DISTINCT FROM a.utm_campaign
  LEFT JOIN public.whatsapp_groups g ON g.id = coalesce(a.group_id, r.group_id)
  ORDER BY 6 DESC, 4 DESC
  LIMIT 200;
$$;
REVOKE EXECUTE ON FUNCTION public.public_catalog_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_catalog_report(uuid) TO authenticated, service_role;