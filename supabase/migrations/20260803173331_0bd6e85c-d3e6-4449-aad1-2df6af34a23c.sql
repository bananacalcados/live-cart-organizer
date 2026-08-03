-- Backfill: acessos da área de membros viram leads no Marketing (origem area_membros)
INSERT INTO public.lp_leads (name, phone, source, campaign_tag, metadata, created_at)
SELECT s.name,
       s.phone,
       'area_membros',
       COALESCE(ev.name, 'Área de Membros'),
       jsonb_build_object('event_id', s.event_id, 'origin', 'minha-area'),
       s.first_at
FROM (
  SELECT phone, event_id, min(created_at) AS first_at,
         (array_agg(name ORDER BY created_at))[1] AS name
  FROM public.live_member_sessions
  WHERE phone IS NOT NULL AND length(regexp_replace(phone, '\D', '', 'g')) >= 8
  GROUP BY phone, event_id
) s
LEFT JOIN public.events ev ON ev.id = s.event_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.lp_leads l
  WHERE l.source = 'area_membros'
    AND RIGHT(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 8)
        = RIGHT(regexp_replace(s.phone, '\D', '', 'g'), 8)
);

DROP FUNCTION IF EXISTS public.get_member_area_leads(uuid, integer, text, integer);

CREATE OR REPLACE FUNCTION public.get_member_area_leads(
  p_event_id uuid DEFAULT NULL,
  p_days integer DEFAULT 90,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  event_name text,
  name text,
  phone text,
  captured_at timestamptz,
  last_seen_at timestamptz,
  visits integer,
  source text,
  is_customer boolean,
  total_orders integer,
  total_spent numeric,
  last_purchase_at timestamptz,
  was_existing_lead boolean,
  first_lead_at timestamptz,
  first_lead_source text,
  prize_count integer,
  prizes jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH captured AS (
    SELECT (array_agg(s.id ORDER BY s.created_at))[1] AS id,
           s.event_id,
           min(s.created_at) AS captured_at,
           max(COALESCE(s.last_seen_at, s.created_at)) AS last_seen_at,
           count(*)::int AS visits,
           (array_agg(s.name ORDER BY s.created_at DESC))[1] AS name,
           s.phone,
           RIGHT(regexp_replace(s.phone, '\D', '', 'g'), 8) AS suffix8
    FROM public.live_member_sessions s
    WHERE s.phone IS NOT NULL
      AND length(regexp_replace(s.phone, '\D', '', 'g')) >= 8
      AND s.created_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 90), 1))
      AND (p_event_id IS NULL OR s.event_id = p_event_id)
    GROUP BY s.phone, s.event_id
  )
  SELECT c.id,
         c.event_id,
         ev.name AS event_name,
         c.name,
         c.phone,
         c.captured_at,
         c.last_seen_at,
         c.visits,
         'area_membros'::text AS source,
         COALESCE(cu.total_orders, 0) + COALESCE(cu.legacy_orders, 0) > 0 AS is_customer,
         (COALESCE(cu.total_orders, 0) + COALESCE(cu.legacy_orders, 0))::integer AS total_orders,
         COALESCE(cu.total_spent, 0) + COALESCE(cu.legacy_spent, 0) AS total_spent,
         GREATEST(cu.last_purchase_at, cu.legacy_last_purchase_at) AS last_purchase_at,
         COALESCE(prev.first_at < c.captured_at - interval '1 minute', false) AS was_existing_lead,
         prev.first_at AS first_lead_at,
         prev.first_source AS first_lead_source,
         COALESCE(pz.prize_count, 0)::integer AS prize_count,
         COALESCE(pz.prizes, '[]'::jsonb) AS prizes
  FROM captured c
  LEFT JOIN public.events ev ON ev.id = c.event_id
  LEFT JOIN LATERAL (
    SELECT cu2.*
    FROM public.customers_unified cu2
    WHERE cu2.phone_suffix8 = c.suffix8
      AND cu2.merged_into_id IS NULL
    ORDER BY (COALESCE(cu2.total_orders,0) + COALESCE(cu2.legacy_orders,0)) DESC
    LIMIT 1
  ) cu ON true
  LEFT JOIN LATERAL (
    SELECT min(t.created_at) AS first_at,
           (array_agg(t.source ORDER BY t.created_at))[1] AS first_source
    FROM (
      SELECT el2.created_at, COALESCE(el2.source, 'evento') AS source
      FROM public.event_leads el2
      WHERE RIGHT(regexp_replace(COALESCE(el2.phone, ''), '\D', '', 'g'), 8) = c.suffix8
      UNION ALL
      SELECT ll.created_at, COALESCE(ll.source, ll.campaign_tag, 'landing_page')
      FROM public.lp_leads ll
      WHERE RIGHT(regexp_replace(COALESCE(ll.phone, ''), '\D', '', 'g'), 8) = c.suffix8
        AND COALESCE(ll.source, '') <> 'area_membros'
    ) t
  ) prev ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS prize_count,
           jsonb_agg(jsonb_build_object(
             'label', cp.prize_label,
             'type', cp.prize_type,
             'value', cp.prize_value,
             'coupon', cp.coupon_code,
             'status', COALESCE(cp.fulfillment_status, 'available'),
             'redeemed', cp.is_redeemed,
             'expires_at', cp.expires_at
           ) ORDER BY cp.created_at DESC) AS prizes
    FROM public.customer_prizes cp
    WHERE RIGHT(regexp_replace(COALESCE(cp.customer_phone, ''), '\D', '', 'g'), 8) = c.suffix8
  ) pz ON true
  WHERE p_search IS NULL
     OR btrim(p_search) = ''
     OR c.name ILIKE '%' || btrim(p_search) || '%'
     OR c.phone ILIKE '%' || regexp_replace(btrim(p_search), '\D', '', 'g') || '%'
  ORDER BY c.captured_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 500), 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_member_area_leads(uuid, integer, text, integer) TO authenticated, service_role;