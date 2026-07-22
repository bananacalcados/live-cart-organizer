
-- Phone key: DDD (2) + last 8 digits = 10 chars, strips leading 55
CREATE OR REPLACE FUNCTION public.event_phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_phone IS NULL THEN NULL
    ELSE NULLIF(
      RIGHT(regexp_replace(p_phone, '\D', '', 'g'), 10),
      ''
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.event_phone_key(text) TO authenticated, anon, service_role;

-- Main analytics RPC
CREATE OR REPLACE FUNCTION public.event_buyer_origin_matrix(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_start timestamptz;
  v_catalog_page_id uuid;
  v_result jsonb;
BEGIN
  SELECT COALESCE(start_date::timestamptz, created_at), catalog_lead_page_id
    INTO v_event_start, v_catalog_page_id
    FROM public.events WHERE id = p_event_id;

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('error', 'event_not_found');
  END IF;

  WITH
  -- Buyers: paid sales of this event
  buyers AS (
    SELECT
      s.id AS sale_id,
      public.event_phone_key(s.customer_phone) AS pkey,
      COALESCE(s.customer_name, '') AS name,
      s.total AS value,
      s.created_at,
      s.payment_method,
      s.sale_type
    FROM public.pos_sales s
    WHERE s.event_id = p_event_id
      AND s.status = 'completed'
      AND s.status_cancelamento = 'ativo'
      AND public.event_phone_key(s.customer_phone) IS NOT NULL
  ),
  buyers_dedup AS (
    SELECT DISTINCT ON (pkey) pkey, sale_id, name, value, created_at, payment_method, sale_type
    FROM buyers
    ORDER BY pkey, created_at ASC
  ),
  -- Non-buyers: catalog registrations for this event's page, not paid
  reg_nb AS (
    SELECT
      r.id,
      public.event_phone_key(r.whatsapp) AS pkey,
      r.instagram_handle,
      r.status,
      r.cart_total,
      r.updated_at
    FROM public.catalog_lead_registrations r
    WHERE r.catalog_page_id = v_catalog_page_id
      AND (r.checkout_sale_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM public.pos_sales ps
             WHERE ps.id = r.checkout_sale_id
               AND ps.status = 'completed'
               AND ps.status_cancelamento = 'ativo'
           ))
      AND public.event_phone_key(r.whatsapp) IS NOT NULL
  ),
  -- Also event_leads without any paid sale
  lead_nb AS (
    SELECT
      el.id,
      public.event_phone_key(el.phone) AS pkey,
      el.instagram,
      el.source,
      el.created_at
    FROM public.event_leads el
    WHERE el.event_id = p_event_id
      AND public.event_phone_key(el.phone) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM buyers b WHERE b.pkey = public.event_phone_key(el.phone))
  ),
  non_buyers_dedup AS (
    SELECT DISTINCT ON (pkey)
      pkey,
      COALESCE(r.instagram_handle, l.instagram, '') AS instagram,
      CASE
        WHEN r.status = 'checkout_started' THEN 'checkout_started'
        WHEN r.status = 'browsing' AND COALESCE(r.cart_total,0) > 0 THEN 'abandoned_cart'
        WHEN r.id IS NOT NULL THEN 'registered_only'
        ELSE 'lead_only'
      END AS reason,
      COALESCE(r.updated_at, l.created_at) AS last_activity_at,
      l.source AS lead_source
    FROM (
      SELECT pkey, instagram_handle, status, cart_total, updated_at, NULL::text AS ig2, NULL::text AS src, id FROM reg_nb
      UNION ALL
      SELECT pkey, NULL::text, NULL::text, NULL::numeric, created_at, instagram, source, id FROM lead_nb
    ) u
    LEFT JOIN reg_nb r USING (pkey)
    LEFT JOIN lead_nb l USING (pkey)
    WHERE NOT EXISTS (SELECT 1 FROM buyers_dedup b WHERE b.pkey = u.pkey)
    ORDER BY pkey, last_activity_at DESC NULLS LAST
  ),
  -- All people to enrich
  everyone AS (
    SELECT pkey, name, 'buyer' AS kind, value, created_at, NULL::text AS reason, NULL::text AS instagram
    FROM buyers_dedup
    UNION ALL
    SELECT pkey, NULL, 'non_buyer', NULL, last_activity_at, reason, instagram
    FROM non_buyers_dedup
  ),
  -- Prior sales (before this event) to detect existing customers
  prior AS (
    SELECT public.event_phone_key(ps.customer_phone) AS pkey,
           MIN(ps.created_at) AS first_prior_at,
           COUNT(*) AS prior_count,
           MAX(ps.sale_type) AS any_sale_type
    FROM public.pos_sales ps
    WHERE ps.status = 'completed'
      AND ps.status_cancelamento = 'ativo'
      AND ps.created_at < v_event_start
      AND (ps.event_id IS NULL OR ps.event_id <> p_event_id)
      AND public.event_phone_key(ps.customer_phone) IS NOT NULL
      AND public.event_phone_key(ps.customer_phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  -- Unified customer
  cust AS (
    SELECT cu.phone_suffix8,
           cu.id AS customer_id,
           cu.name AS cu_name,
           cu.instagram_handle,
           cu.total_orders,
           cu.first_purchase_at,
           cu.last_purchase_at,
           cu.rfm_segment,
           cu.source_origins,
           cu.tags
    FROM public.customers_unified cu
    WHERE cu.phone_suffix8 IS NOT NULL
      AND cu.phone_suffix8 IN (SELECT RIGHT(pkey,8) FROM everyone)
  ),
  -- Leads across sources (matches whichever exists)
  lead_lp AS (
    SELECT public.event_phone_key(phone) AS pkey,
           MIN(created_at) AS first_at,
           string_agg(DISTINCT campaign_tag, ', ') AS tags
    FROM public.lp_leads
    WHERE public.event_phone_key(phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  lead_ev AS (
    SELECT public.event_phone_key(phone) AS pkey,
           MIN(created_at) AS first_at,
           string_agg(DISTINCT source, ', ') AS sources
    FROM public.event_leads
    WHERE public.event_phone_key(phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  lead_reg AS (
    SELECT public.event_phone_key(whatsapp) AS pkey,
           MIN(created_at) AS first_at
    FROM public.catalog_lead_registrations
    WHERE public.event_phone_key(whatsapp) IN (SELECT pkey FROM everyone)
      AND catalog_page_id <> COALESCE(v_catalog_page_id, '00000000-0000-0000-0000-000000000000'::uuid)
    GROUP BY 1
  ),
  lead_chat AS (
    SELECT public.event_phone_key(phone) AS pkey, MIN(created_at) AS first_at
    FROM public.chat_contacts
    WHERE public.event_phone_key(phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  zoppy AS (
    SELECT public.event_phone_key(phone) AS pkey, 1 AS x
    FROM public.zoppy_customers
    WHERE public.event_phone_key(phone) IN (SELECT pkey FROM everyone)
  ),
  -- Final classification
  classified AS (
    SELECT
      e.pkey,
      e.kind,
      e.name,
      e.instagram,
      e.value,
      e.created_at,
      e.reason,
      p.prior_count,
      p.first_prior_at,
      c.customer_id, c.cu_name, c.instagram_handle AS cu_ig, c.total_orders, c.first_purchase_at, c.rfm_segment, c.source_origins,
      lp.tags AS lp_tags, lp.first_at AS lp_first,
      le.sources AS ev_sources, le.first_at AS ev_first,
      lr.first_at AS reg_first,
      lc.first_at AS chat_first,
      z.x AS in_zoppy,
      CASE
        WHEN COALESCE(p.prior_count,0) > 0 OR COALESCE(c.total_orders,0) > 0 OR z.x IS NOT NULL THEN 'existing_customer'
        WHEN lp.pkey IS NOT NULL OR le.pkey IS NOT NULL OR lr.pkey IS NOT NULL OR lc.pkey IS NOT NULL THEN 'lead_first_purchase'
        ELSE 'brand_new'
      END AS bucket
    FROM everyone e
    LEFT JOIN prior p     ON p.pkey = e.pkey
    LEFT JOIN cust c      ON c.phone_suffix8 = RIGHT(e.pkey,8)
    LEFT JOIN lead_lp lp  ON lp.pkey = e.pkey
    LEFT JOIN lead_ev le  ON le.pkey = e.pkey
    LEFT JOIN lead_reg lr ON lr.pkey = e.pkey
    LEFT JOIN lead_chat lc ON lc.pkey = e.pkey
    LEFT JOIN zoppy z     ON z.pkey = e.pkey
  )
  SELECT jsonb_build_object(
    'event_id', p_event_id,
    'event_start', v_event_start,
    'buyers', jsonb_build_object(
      'total',                (SELECT COUNT(*) FROM classified WHERE kind='buyer'),
      'lead_first_purchase',  (SELECT COUNT(*) FROM classified WHERE kind='buyer' AND bucket='lead_first_purchase'),
      'existing_customers',   (SELECT COUNT(*) FROM classified WHERE kind='buyer' AND bucket='existing_customer'),
      'brand_new',            (SELECT COUNT(*) FROM classified WHERE kind='buyer' AND bucket='brand_new'),
      'revenue',              (SELECT COALESCE(SUM(value),0) FROM classified WHERE kind='buyer')
    ),
    'non_buyers', jsonb_build_object(
      'total',                (SELECT COUNT(*) FROM classified WHERE kind='non_buyer'),
      'lead_first_purchase',  (SELECT COUNT(*) FROM classified WHERE kind='non_buyer' AND bucket='lead_first_purchase'),
      'existing_customers',   (SELECT COUNT(*) FROM classified WHERE kind='non_buyer' AND bucket='existing_customer'),
      'brand_new',            (SELECT COUNT(*) FROM classified WHERE kind='non_buyer' AND bucket='brand_new'),
      'by_reason',            (SELECT jsonb_object_agg(reason, cnt) FROM (
                                  SELECT COALESCE(reason,'unknown') AS reason, COUNT(*) AS cnt
                                  FROM classified WHERE kind='non_buyer' GROUP BY 1
                                ) r)
    ),
    'buyer_list', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'phone_key', pkey,
        'name', COALESCE(NULLIF(name,''), cu_name),
        'instagram', COALESCE(NULLIF(instagram,''), cu_ig),
        'bucket', bucket,
        'value', value,
        'created_at', created_at,
        'sources', jsonb_build_object(
          'prior_sales', COALESCE(prior_count,0),
          'first_prior_at', first_prior_at,
          'in_customers_unified', customer_id IS NOT NULL,
          'total_orders_unified', COALESCE(total_orders,0),
          'first_purchase_at', first_purchase_at,
          'rfm_segment', rfm_segment,
          'acquisition_origins', source_origins,
          'lp_leads_tags', lp_tags,
          'event_leads_sources', ev_sources,
          'prior_catalog_reg', reg_first IS NOT NULL,
          'in_chat_contacts', chat_first IS NOT NULL,
          'in_zoppy', in_zoppy IS NOT NULL
        )
      ) ORDER BY value DESC), '[]'::jsonb)
      FROM classified WHERE kind='buyer'
    ),
    'non_buyer_list', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'phone_key', pkey,
        'name', COALESCE(NULLIF(name,''), cu_name),
        'instagram', COALESCE(NULLIF(instagram,''), cu_ig),
        'bucket', bucket,
        'reason', reason,
        'last_activity_at', created_at,
        'sources', jsonb_build_object(
          'prior_sales', COALESCE(prior_count,0),
          'first_prior_at', first_prior_at,
          'in_customers_unified', customer_id IS NOT NULL,
          'total_orders_unified', COALESCE(total_orders,0),
          'first_purchase_at', first_purchase_at,
          'rfm_segment', rfm_segment,
          'acquisition_origins', source_origins,
          'lp_leads_tags', lp_tags,
          'event_leads_sources', ev_sources,
          'prior_catalog_reg', reg_first IS NOT NULL,
          'in_chat_contacts', chat_first IS NOT NULL,
          'in_zoppy', in_zoppy IS NOT NULL
        )
      ) ORDER BY created_at DESC NULLS LAST), '[]'::jsonb)
      FROM classified WHERE kind='non_buyer'
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.event_buyer_origin_matrix(uuid) TO authenticated, service_role;
