CREATE OR REPLACE FUNCTION public.events_buyer_origin_matrix_range(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH
  ev_ids AS (
    SELECT
      e.id,
      COALESCE(e.start_date::timestamptz, e.created_at) AS ev_start,
      e.catalog_lead_page_id
    FROM public.events e
    WHERE (
      (e.start_date IS NOT NULL AND e.start_date::timestamptz >= p_from AND e.start_date::timestamptz <= p_to)
      OR (e.start_date IS NULL AND e.created_at >= p_from AND e.created_at <= p_to)
    )
      AND (p_channel IS NULL OR e.channel::text = p_channel)
  ),
  ev_orders AS (
    SELECT
      o.id AS order_id,
      o.event_id,
      ei.ev_start,
      public.event_phone_key(c.whatsapp) AS pkey,
      COALESCE(NULLIF(cu.name, ''), '') AS name,
      c.instagram_handle AS instagram,
      public.bc_order_total(o.products, o.discount_type, o.discount_value) AS value,
      COALESCE(o.updated_at, o.created_at) AS activity_at,
      o.created_at,
      (COALESCE(o.is_paid, false)
        OR COALESCE(o.paid_externally, false)
        OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])) AS is_paid_like,
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
  buyers_raw AS (
    SELECT * FROM ev_orders WHERE is_paid_like = true
  ),
  buyers_dedup AS (
    SELECT DISTINCT ON (pkey)
      pkey, order_id, event_id, ev_start, name, instagram, value, created_at
    FROM buyers_raw
    ORDER BY pkey, created_at ASC
  ),
  nb_raw AS (
    SELECT
      order_id AS id,
      pkey,
      event_id,
      ev_start,
      instagram,
      name,
      activity_at,
      CASE
        WHEN checkout_started_at IS NOT NULL THEN 'checkout_started'
        WHEN stage = 'incomplete_order' THEN 'registered_only'
        ELSE 'abandoned_cart'
      END AS reason
    FROM ev_orders eo
    WHERE is_paid_like = false
      AND NOT EXISTS (SELECT 1 FROM buyers_dedup b WHERE b.pkey = eo.pkey)
  ),
  non_buyers_dedup AS (
    SELECT DISTINCT ON (pkey)
      pkey, event_id, ev_start, name, instagram, reason, activity_at AS last_activity_at
    FROM nb_raw
    ORDER BY pkey, activity_at DESC NULLS LAST
  ),
  everyone AS (
    SELECT pkey, event_id, ev_start, name, instagram, 'buyer'::text AS kind, value, created_at, NULL::text AS reason
    FROM buyers_dedup
    UNION ALL
    SELECT pkey, event_id, ev_start, name, instagram, 'non_buyer'::text, NULL::numeric, last_activity_at, reason
    FROM non_buyers_dedup
  ),
  prior_ps AS (
    SELECT
      e.pkey,
      MIN(ps.created_at) AS first_prior_at,
      COUNT(*) AS prior_count
    FROM everyone e
    JOIN public.pos_sales ps
      ON public.event_phone_key(ps.customer_phone) = e.pkey
    WHERE ps.status IN ('paid','completed','pending_pickup')
      AND ps.status_cancelamento = 'ativo'
      AND ps.created_at < e.ev_start
      AND (ps.event_id IS NULL OR ps.event_id <> e.event_id)
    GROUP BY e.pkey
  ),
  prior_ord AS (
    SELECT
      e.pkey,
      MIN(o2.created_at) AS first_prior_at,
      COUNT(*) AS prior_count
    FROM everyone e
    JOIN public.orders o2 ON true
    LEFT JOIN public.customers c2 ON c2.id = o2.customer_id
    WHERE public.event_phone_key(c2.whatsapp) = e.pkey
      AND (o2.event_id IS NULL OR o2.event_id <> e.event_id)
      AND o2.created_at < e.ev_start
      AND (COALESCE(o2.is_paid, false)
        OR COALESCE(o2.paid_externally, false)
        OR o2.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))
    GROUP BY e.pkey
  ),
  prior AS (
    SELECT
      pkey,
      SUM(prior_count)::int AS prior_count,
      MIN(first_prior_at) AS first_prior_at
    FROM (
      SELECT * FROM prior_ps
      UNION ALL
      SELECT * FROM prior_ord
    ) u
    GROUP BY pkey
  ),
  cust AS (
    SELECT DISTINCT ON (public.event_phone_key(cu.phone_e164))
      public.event_phone_key(cu.phone_e164) AS pkey,
      cu.id AS customer_id,
      cu.name AS cu_name,
      cu.instagram_handle,
      cu.total_orders,
      cu.first_purchase_at,
      cu.rfm_segment,
      cu.source_origins
    FROM public.customers_unified cu
    WHERE public.event_phone_key(cu.phone_e164) IS NOT NULL
      AND public.event_phone_key(cu.phone_e164) IN (SELECT pkey FROM everyone)
    ORDER BY public.event_phone_key(cu.phone_e164), cu.total_orders DESC NULLS LAST
  ),
  lp AS (
    SELECT
      e.pkey,
      string_agg(DISTINCT ll.campaign_tag, ',') AS tags
    FROM everyone e
    JOIN public.lp_leads ll
      ON public.event_phone_key(ll.phone) = e.pkey
    WHERE ll.created_at < e.ev_start
    GROUP BY e.pkey
  ),
  ev_lead_src AS (
    SELECT
      e.pkey,
      string_agg(DISTINCT el.source, ',') AS srcs
    FROM everyone e
    JOIN public.event_leads el
      ON public.event_phone_key(el.phone) = e.pkey
    WHERE el.created_at < e.ev_start
    GROUP BY e.pkey
  ),
  prior_reg AS (
    SELECT DISTINCT e.pkey
    FROM everyone e
    JOIN public.catalog_lead_registrations r
      ON public.event_phone_key(r.whatsapp) = e.pkey
    WHERE r.created_at < e.ev_start
      AND (
        r.catalog_page_id IS NULL
        OR r.catalog_page_id <> COALESCE(
          (SELECT ev.catalog_lead_page_id FROM ev_ids ev WHERE ev.id = e.event_id),
          '00000000-0000-0000-0000-000000000000'::uuid
        )
      )
  ),
  current_reg AS (
    SELECT DISTINCT e.pkey
    FROM everyone e
    JOIN ev_ids ev ON ev.id = e.event_id
    JOIN public.catalog_lead_registrations r
      ON r.catalog_page_id = ev.catalog_lead_page_id
     AND public.event_phone_key(r.whatsapp) = e.pkey
    WHERE ev.catalog_lead_page_id IS NOT NULL
  ),
  cc AS (
    SELECT DISTINCT e.pkey
    FROM everyone e
    JOIN public.chat_contacts cc
      ON public.event_phone_key(cc.phone) = e.pkey
    WHERE cc.created_at < e.ev_start
  ),
  zp AS (
    SELECT DISTINCT e.pkey
    FROM everyone e
    JOIN public.zoppy_customers z
      ON public.event_phone_key(z.phone) = e.pkey
  ),
  classified AS (
    SELECT
      e.*,
      COALESCE(p.prior_count, 0) AS prior_sales,
      p.first_prior_at,
      c.customer_id IS NOT NULL AS in_cu,
      c.cu_name,
      c.instagram_handle AS cu_ig,
      c.total_orders,
      c.first_purchase_at,
      c.rfm_segment,
      c.source_origins,
      lp.tags AS lp_tags,
      es.srcs AS ev_srcs,
      pr.pkey IS NOT NULL AS prior_catalog_reg,
      cr.pkey IS NOT NULL AS current_catalog_reg,
      cc.pkey IS NOT NULL AS in_chat,
      zp.pkey IS NOT NULL AS in_zoppy,
      CASE
        WHEN COALESCE(p.prior_count, 0) > 0
          OR (c.customer_id IS NOT NULL AND c.first_purchase_at IS NOT NULL AND c.first_purchase_at < e.ev_start)
          THEN 'existing_customer'
        WHEN (lp.tags IS NOT NULL OR es.srcs IS NOT NULL OR pr.pkey IS NOT NULL OR cr.pkey IS NOT NULL OR cc.pkey IS NOT NULL OR zp.pkey IS NOT NULL)
          THEN 'lead_first_purchase'
        ELSE 'brand_new'
      END AS bucket
    FROM everyone e
    LEFT JOIN prior p USING (pkey)
    LEFT JOIN cust c USING (pkey)
    LEFT JOIN lp USING (pkey)
    LEFT JOIN ev_lead_src es USING (pkey)
    LEFT JOIN prior_reg pr USING (pkey)
    LEFT JOIN current_reg cr USING (pkey)
    LEFT JOIN cc USING (pkey)
    LEFT JOIN zp USING (pkey)
  ),
  buyer_rows AS (
    SELECT
      jsonb_build_object(
        'phone_key', pkey,
        'name', COALESCE(NULLIF(name, ''), cu_name, '(sem nome)'),
        'instagram', COALESCE(NULLIF(instagram, ''), cu_ig),
        'bucket', bucket,
        'value', value,
        'created_at', created_at,
        'sources', jsonb_build_object(
          'prior_sales', prior_sales,
          'first_prior_at', first_prior_at,
          'in_customers_unified', in_cu,
          'total_orders_unified', total_orders,
          'first_purchase_at', first_purchase_at,
          'rfm_segment', rfm_segment,
          'acquisition_origins', source_origins,
          'lp_leads_tags', lp_tags,
          'event_leads_sources', ev_srcs,
          'prior_catalog_reg', prior_catalog_reg,
          'current_catalog_reg', current_catalog_reg,
          'in_chat_contacts', in_chat,
          'in_zoppy', in_zoppy
        )
      ) AS row,
      bucket,
      value
    FROM classified
    WHERE kind = 'buyer'
  ),
  non_buyer_rows AS (
    SELECT
      jsonb_build_object(
        'phone_key', pkey,
        'name', COALESCE(NULLIF(name, ''), cu_name, '(sem nome)'),
        'instagram', COALESCE(NULLIF(instagram, ''), cu_ig),
        'bucket', bucket,
        'reason', reason,
        'last_activity_at', created_at,
        'sources', jsonb_build_object(
          'prior_sales', prior_sales,
          'first_prior_at', first_prior_at,
          'in_customers_unified', in_cu,
          'total_orders_unified', total_orders,
          'first_purchase_at', first_purchase_at,
          'rfm_segment', rfm_segment,
          'acquisition_origins', source_origins,
          'lp_leads_tags', lp_tags,
          'event_leads_sources', ev_srcs,
          'prior_catalog_reg', prior_catalog_reg,
          'current_catalog_reg', current_catalog_reg,
          'in_chat_contacts', in_chat,
          'in_zoppy', in_zoppy
        )
      ) AS row,
      bucket,
      reason
    FROM classified
    WHERE kind = 'non_buyer'
  )
  SELECT jsonb_build_object(
    'events_count', (SELECT count(*) FROM ev_ids),
    'buyers', jsonb_build_object(
      'total', (SELECT count(*) FROM buyer_rows),
      'lead_first_purchase', (SELECT count(*) FROM buyer_rows WHERE bucket = 'lead_first_purchase'),
      'existing_customers', (SELECT count(*) FROM buyer_rows WHERE bucket = 'existing_customer'),
      'brand_new', (SELECT count(*) FROM buyer_rows WHERE bucket = 'brand_new'),
      'revenue', COALESCE((SELECT sum(value) FROM buyer_rows), 0)
    ),
    'non_buyers', jsonb_build_object(
      'total', (SELECT count(*) FROM non_buyer_rows),
      'lead_first_purchase', (SELECT count(*) FROM non_buyer_rows WHERE bucket = 'lead_first_purchase'),
      'existing_customers', (SELECT count(*) FROM non_buyer_rows WHERE bucket = 'existing_customer'),
      'brand_new', (SELECT count(*) FROM non_buyer_rows WHERE bucket = 'brand_new'),
      'by_reason', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) n FROM non_buyer_rows GROUP BY reason) t), '{}'::jsonb)
    ),
    'buyer_list', COALESCE((SELECT jsonb_agg(row) FROM buyer_rows), '[]'::jsonb),
    'non_buyer_list', COALESCE((SELECT jsonb_agg(row) FROM non_buyer_rows), '[]'::jsonb)
  ) INTO v_result;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'events_count', 0,
      'buyers', jsonb_build_object('total', 0, 'lead_first_purchase', 0, 'existing_customers', 0, 'brand_new', 0, 'revenue', 0),
      'non_buyers', jsonb_build_object('total', 0, 'lead_first_purchase', 0, 'existing_customers', 0, 'brand_new', 0, 'by_reason', '{}'::jsonb),
      'buyer_list', '[]'::jsonb,
      'non_buyer_list', '[]'::jsonb
    )
  );
END;
$function$;