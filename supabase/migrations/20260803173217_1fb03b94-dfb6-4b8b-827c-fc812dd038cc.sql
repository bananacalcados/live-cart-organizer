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
    SELECT el.id,
           el.event_id,
           ev.name AS event_name,
           el.name,
           el.phone,
           el.created_at AS captured_at,
           COALESCE(el.source, 'member_area') AS source,
           RIGHT(regexp_replace(COALESCE(el.phone, ''), '\D', '', 'g'), 8) AS suffix8
    FROM public.event_leads el
    LEFT JOIN public.events ev ON ev.id = el.event_id
    WHERE el.source IN ('member_area', 'area_membros')
      AND el.created_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 90), 1))
      AND (p_event_id IS NULL OR el.event_id = p_event_id)
      AND length(regexp_replace(COALESCE(el.phone, ''), '\D', '', 'g')) >= 8
  )
  SELECT c.id,
         c.event_id,
         c.event_name,
         c.name,
         c.phone,
         c.captured_at,
         c.source,
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