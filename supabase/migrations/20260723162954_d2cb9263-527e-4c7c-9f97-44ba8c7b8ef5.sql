CREATE OR REPLACE FUNCTION public.events_buyer_origin_matrix_range(p_from timestamp with time zone, p_to timestamp with time zone, p_channel text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  WITH
  ev_ids AS (
    SELECT e.id, COALESCE(e.start_date::timestamptz, e.created_at) AS ev_start,
           e.catalog_lead_page_id
    FROM public.events e
    WHERE (
      (e.start_date IS NOT NULL AND e.start_date >= p_from AND e.start_date <= p_to)
      OR (e.start_date IS NULL AND e.created_at >= p_from AND e.created_at <= p_to)
    )
    AND (p_channel IS NULL OR e.channel::text = p_channel)
  ),
  ev_orders AS (
    SELECT
      o.id AS order_id,
      o.event_id,
      public.event_phone_key(c.whatsapp) AS pkey,
      COALESCE(NULLIF(cu.name,''), '') AS name,
      c.instagram_handle AS instagram,
      public.bc_order_total(o.products, o.discount_type, o.discount_value) AS value,
      COALESCE(o.updated_at, o.created_at) AS activity_at,
      o.created_at,
      (COALESCE(o.is_paid,false)
        OR COALESCE(o.paid_externally,false)
        OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))
        AS is_paid_like,
      o.stage,
      o.checkout_started_at,
      o.merged_into_order_id
    FROM public.orders o
    JOIN ev_ids ei ON ei.id = o.event_id
    LEFT JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.customers_unified cu ON cu.id = o.customer_unified_id
    WHERE o.stage <> 'cancelled'
      AND o.merged_into_order_id IS NULL
      AND public.event_phone_key(c.whatsapp) IS NOT NULL
  ),
  buyers_raw AS (SELECT * FROM ev_orders WHERE is_paid_like = true),
  buyers_dedup AS (
    SELECT DISTINCT ON (pkey) pkey, order_id, name, instagram, value, created_at
    FROM buyers_raw
    ORDER BY pkey, created_at ASC
  ),
  nb_raw AS (
    SELECT
      order_id AS id, pkey, instagram, name, activity_at,
      CASE
        WHEN checkout_started_at IS NOT NULL THEN 'checkout_started'
        WHEN stage = 'incomplete_order' THEN 'registered_only'
        ELSE 'abandoned_cart'
      END AS reason
    FROM ev_orders
    WHERE is_paid_like = false
      AND NOT EXISTS (SELECT 1 FROM buyers_dedup b WHERE b.pkey = ev_orders.pkey)
  ),
  non_buyers_dedup AS (
    SELECT DISTINCT ON (pkey) pkey, name, instagram, reason, activity_at AS last_activity_at
    FROM nb_raw
    ORDER BY pkey, activity_at DESC NULLS LAST
  ),
  everyone AS (
    SELECT pkey, name, instagram, 'buyer'::text AS kind, value, created_at, NULL::text AS reason FROM buyers_dedup
    UNION ALL
    SELECT pkey, name, instagram, 'non_buyer'::text, NULL::numeric, last_activity_at, reason FROM non_buyers_dedup
  ),
  prior_ps AS (
    SELECT public.event_phone_key(ps.customer_phone) AS pkey,
           MIN(ps.created_at) AS first_prior_at, COUNT(*) AS prior_count
    FROM public.pos_sales ps
    WHERE ps.status IN ('paid','completed','pending_pickup') AND ps.status_cancelamento='ativo'
      AND ps.created_at < p_from
      AND (ps.event_id IS NULL OR ps.event_id NOT IN (SELECT id FROM ev_ids))
      AND public.event_phone_key(ps.customer_phone) IS NOT NULL
      AND public.event_phone_key(ps.customer_phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  prior_ord AS (
    SELECT public.event_phone_key(c2.whatsapp) AS pkey,
           MIN(o2.created_at) AS first_prior_at, COUNT(*) AS prior_count
    FROM public.orders o2
    LEFT JOIN public.customers c2 ON c2.id = o2.customer_id
    WHERE (o2.event_id IS NULL OR o2.event_id NOT IN (SELECT id FROM ev_ids))
      AND o2.created_at < p_from
      AND (COALESCE(o2.is_paid,false) OR COALESCE(o2.paid_externally,false)
           OR o2.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))
      AND public.event_phone_key(c2.whatsapp) IS NOT NULL
      AND public.event_phone_key(c2.whatsapp) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  prior AS (
    SELECT pkey,
           SUM(prior_count)::int AS prior_count,
           MIN(first_prior_at) AS first_prior_at
    FROM (SELECT * FROM prior_ps UNION ALL SELECT * FROM prior_ord) u
    GROUP BY pkey
  ),
  cust AS (
    SELECT DISTINCT ON (public.event_phone_key(cu.phone_e164))
           public.event_phone_key(cu.phone_e164) AS pkey,
           cu.id AS customer_id, cu.name AS cu_name, cu.instagram_handle,
           cu.total_orders, cu.total_spent
    FROM public.customers_unified cu
    WHERE public.event_phone_key(cu.phone_e164) IS NOT NULL
      AND public.event_phone_key(cu.phone_e164) IN (SELECT pkey FROM everyone)
    ORDER BY public.event_phone_key(cu.phone_e164), cu.total_orders DESC NULLS LAST
  ),
  lead_hit AS (
    SELECT public.event_phone_key(clr.telefone) AS pkey, MIN(clr.created_at) AS lead_at
    FROM public.catalog_lead_registrations clr
    WHERE clr.catalog_lead_page_id IN (SELECT catalog_lead_page_id FROM ev_ids WHERE catalog_lead_page_id IS NOT NULL)
      AND public.event_phone_key(clr.telefone) IS NOT NULL
      AND public.event_phone_key(clr.telefone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  classified AS (
    SELECT e.*,
      COALESCE(p.prior_count, 0) AS prior_count,
      p.first_prior_at,
      lh.lead_at,
      c.customer_id, c.cu_name, c.instagram_handle AS cu_ig, c.total_orders, c.total_spent,
      CASE
        WHEN COALESCE(p.prior_count,0) > 0 THEN 'recurring'
        WHEN lh.lead_at IS NOT NULL THEN 'lead_first_purchase'
        ELSE 'brand_new'
      END AS origin
    FROM everyone e
    LEFT JOIN prior p ON p.pkey = e.pkey
    LEFT JOIN lead_hit lh ON lh.pkey = e.pkey
    LEFT JOIN cust c ON c.pkey = e.pkey
  )
  SELECT jsonb_build_object(
    'buyers', jsonb_build_object(
      'total', (SELECT count(*) FROM classified WHERE kind='buyer'),
      'lead_first_purchase', (SELECT count(*) FROM classified WHERE kind='buyer' AND origin='lead_first_purchase'),
      'recurring', (SELECT count(*) FROM classified WHERE kind='buyer' AND origin='recurring'),
      'brand_new', (SELECT count(*) FROM classified WHERE kind='buyer' AND origin='brand_new'),
      'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pkey', pkey, 'name', COALESCE(NULLIF(name,''), cu_name), 'instagram', COALESCE(instagram, cu_ig),
        'value', value, 'created_at', created_at, 'origin', origin,
        'prior_count', prior_count, 'first_prior_at', first_prior_at,
        'customer_id', customer_id, 'total_orders', total_orders, 'total_spent', total_spent
      )), '[]'::jsonb) FROM classified WHERE kind='buyer')
    ),
    'non_buyers', jsonb_build_object(
      'total', (SELECT count(*) FROM classified WHERE kind='non_buyer'),
      'lead_first_purchase', (SELECT count(*) FROM classified WHERE kind='non_buyer' AND origin='lead_first_purchase'),
      'recurring', (SELECT count(*) FROM classified WHERE kind='non_buyer' AND origin='recurring'),
      'brand_new', (SELECT count(*) FROM classified WHERE kind='non_buyer' AND origin='brand_new'),
      'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pkey', pkey, 'name', COALESCE(NULLIF(name,''), cu_name), 'instagram', COALESCE(instagram, cu_ig),
        'last_activity_at', created_at, 'reason', reason, 'origin', origin,
        'prior_count', prior_count, 'first_prior_at', first_prior_at,
        'customer_id', customer_id, 'total_orders', total_orders, 'total_spent', total_spent
      )), '[]'::jsonb) FROM classified WHERE kind='non_buyer')
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;