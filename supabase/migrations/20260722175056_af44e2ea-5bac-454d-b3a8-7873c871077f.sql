
CREATE OR REPLACE FUNCTION public.event_buyer_origin_matrix(p_event_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_event_start timestamptz; v_catalog_page_id uuid; v_result jsonb;
BEGIN
  SELECT COALESCE(start_date::timestamptz, created_at), catalog_lead_page_id
    INTO v_event_start, v_catalog_page_id FROM public.events WHERE id = p_event_id;
  IF v_event_start IS NULL THEN RETURN jsonb_build_object('error','event_not_found'); END IF;

  WITH
  buyers AS (
    SELECT s.id AS sale_id, public.event_phone_key(s.customer_phone) AS pkey,
           COALESCE(s.customer_name,'') AS name, s.total AS value, s.created_at
    FROM public.pos_sales s
    WHERE s.event_id = p_event_id
      AND s.status IN ('paid','completed','pending_pickup')
      AND s.status_cancelamento='ativo'
      AND public.event_phone_key(s.customer_phone) IS NOT NULL
  ),
  buyers_dedup AS (
    SELECT DISTINCT ON (pkey) pkey, sale_id, name, value, created_at
    FROM buyers ORDER BY pkey, created_at ASC
  ),
  reg_nb AS (
    SELECT r.id, public.event_phone_key(r.whatsapp) AS pkey, r.instagram_handle,
           r.status, r.cart_total, r.updated_at
    FROM public.catalog_lead_registrations r
    WHERE r.catalog_page_id = v_catalog_page_id
      AND (r.checkout_sale_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pos_sales ps WHERE ps.id=r.checkout_sale_id
        AND ps.status IN ('paid','completed','pending_pickup') AND ps.status_cancelamento='ativo'))
      AND public.event_phone_key(r.whatsapp) IS NOT NULL
  ),
  lead_nb AS (
    SELECT el.id, public.event_phone_key(el.phone) AS pkey, el.instagram, el.source, el.created_at
    FROM public.event_leads el
    WHERE el.event_id = p_event_id
      AND public.event_phone_key(el.phone) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM buyers b WHERE b.pkey=public.event_phone_key(el.phone))
  ),
  -- NEW: unpaid orders belonging to the event (kanban pipeline)
  ord_nb AS (
    SELECT o.id,
           public.event_phone_key(c.whatsapp) AS pkey,
           c.instagram_handle AS instagram,
           CASE
             WHEN o.checkout_started_at IS NOT NULL THEN 'checkout_started'
             WHEN o.stage = 'incomplete_order' THEN 'registered_only'
             ELSE 'abandoned_cart'
           END AS reason,
           COALESCE(o.updated_at, o.created_at) AS last_activity_at
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.event_id = p_event_id
      AND COALESCE(o.is_paid,false) = false
      AND o.stage <> 'cancelled'
      AND o.merged_into_order_id IS NULL
      AND public.event_phone_key(c.whatsapp) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM buyers b WHERE b.pkey = public.event_phone_key(c.whatsapp))
  ),
  non_buyers_dedup AS (
    SELECT DISTINCT ON (u.pkey) u.pkey,
      COALESCE(r.instagram_handle, l.instagram, o.instagram, '') AS instagram,
      COALESCE(
        CASE WHEN r.status='checkout_started' THEN 'checkout_started'
             WHEN r.status='browsing' AND COALESCE(r.cart_total,0)>0 THEN 'abandoned_cart'
             WHEN r.id IS NOT NULL THEN 'registered_only' END,
        o.reason,
        CASE WHEN l.id IS NOT NULL THEN 'lead_only' END
      ) AS reason,
      GREATEST(
        COALESCE(r.updated_at, '-infinity'::timestamptz),
        COALESCE(l.created_at, '-infinity'::timestamptz),
        COALESCE(o.last_activity_at, '-infinity'::timestamptz)
      ) AS last_activity_at
    FROM (
      SELECT pkey FROM reg_nb
      UNION SELECT pkey FROM lead_nb
      UNION SELECT pkey FROM ord_nb
    ) u
    LEFT JOIN reg_nb r USING (pkey)
    LEFT JOIN lead_nb l USING (pkey)
    LEFT JOIN ord_nb o USING (pkey)
    WHERE NOT EXISTS (SELECT 1 FROM buyers_dedup b WHERE b.pkey=u.pkey)
    ORDER BY u.pkey, last_activity_at DESC NULLS LAST
  ),
  everyone AS (
    SELECT pkey, name, 'buyer' AS kind, value, created_at, NULL::text AS reason, NULL::text AS instagram FROM buyers_dedup
    UNION ALL
    SELECT pkey, NULL, 'non_buyer', NULL, last_activity_at, reason, instagram FROM non_buyers_dedup
  ),
  prior AS (
    SELECT public.event_phone_key(ps.customer_phone) AS pkey,
           MIN(ps.created_at) AS first_prior_at, COUNT(*) AS prior_count
    FROM public.pos_sales ps
    WHERE ps.status IN ('paid','completed','pending_pickup') AND ps.status_cancelamento='ativo'
      AND ps.created_at < v_event_start
      AND (ps.event_id IS NULL OR ps.event_id <> p_event_id)
      AND public.event_phone_key(ps.customer_phone) IS NOT NULL
      AND public.event_phone_key(ps.customer_phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  cust AS (
    SELECT cu.phone_suffix8, cu.id AS customer_id, cu.name AS cu_name, cu.instagram_handle,
           cu.total_orders, cu.first_purchase_at, cu.rfm_segment, cu.source_origins
    FROM public.customers_unified cu
    WHERE cu.phone_suffix8 IN (SELECT RIGHT(pkey,8) FROM everyone)
  ),
  lp AS (
    SELECT public.event_phone_key(ll.phone) AS pkey,
           string_agg(DISTINCT ll.campaign_tag,',') AS tags
    FROM public.lp_leads ll
    WHERE public.event_phone_key(ll.phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  ev_lead_src AS (
    SELECT public.event_phone_key(el.phone) AS pkey,
           string_agg(DISTINCT el.source,',') AS srcs
    FROM public.event_leads el
    WHERE public.event_phone_key(el.phone) IN (SELECT pkey FROM everyone)
    GROUP BY 1
  ),
  prior_reg AS (
    SELECT DISTINCT public.event_phone_key(r.whatsapp) AS pkey
    FROM public.catalog_lead_registrations r
    WHERE r.created_at < v_event_start
      AND (r.catalog_page_id IS NULL OR r.catalog_page_id <> COALESCE(v_catalog_page_id,'00000000-0000-0000-0000-000000000000'::uuid))
      AND public.event_phone_key(r.whatsapp) IN (SELECT pkey FROM everyone)
  ),
  cc AS (
    SELECT DISTINCT public.event_phone_key(cc.phone) AS pkey FROM public.chat_contacts cc
    WHERE public.event_phone_key(cc.phone) IN (SELECT pkey FROM everyone)
  ),
  zp AS (
    SELECT DISTINCT public.event_phone_key(z.phone) AS pkey FROM public.zoppy_customers z
    WHERE public.event_phone_key(z.phone) IN (SELECT pkey FROM everyone)
  ),
  classified AS (
    SELECT e.*, COALESCE(p.prior_count,0) AS prior_sales, p.first_prior_at,
      c.customer_id IS NOT NULL AS in_cu, c.cu_name, c.instagram_handle AS cu_ig,
      c.total_orders, c.first_purchase_at, c.rfm_segment, c.source_origins,
      lp.tags AS lp_tags, es.srcs AS ev_srcs,
      pr.pkey IS NOT NULL AS prior_catalog_reg,
      cc.pkey IS NOT NULL AS in_chat, zp.pkey IS NOT NULL AS in_zoppy,
      CASE
        WHEN COALESCE(p.prior_count,0)>0 OR (c.customer_id IS NOT NULL AND COALESCE(c.total_orders,0)>0)
          THEN 'existing_customer'
        WHEN (lp.tags IS NOT NULL OR es.srcs IS NOT NULL OR pr.pkey IS NOT NULL OR cc.pkey IS NOT NULL OR zp.pkey IS NOT NULL OR c.customer_id IS NOT NULL)
          THEN 'lead_first_purchase'
        ELSE 'brand_new'
      END AS bucket
    FROM everyone e
    LEFT JOIN prior p USING (pkey)
    LEFT JOIN cust c ON c.phone_suffix8 = RIGHT(e.pkey,8)
    LEFT JOIN lp USING (pkey)
    LEFT JOIN ev_lead_src es USING (pkey)
    LEFT JOIN prior_reg pr USING (pkey)
    LEFT JOIN cc USING (pkey)
    LEFT JOIN zp USING (pkey)
  ),
  buyer_rows AS (
    SELECT jsonb_build_object(
      'phone_key',pkey,'name',COALESCE(NULLIF(name,''),cu_name,'(sem nome)'),
      'instagram',COALESCE(NULLIF(instagram,''),cu_ig),
      'bucket',bucket,'value',value,'created_at',created_at,
      'sources',jsonb_build_object(
        'prior_sales',prior_sales,'first_prior_at',first_prior_at,
        'in_customers_unified',in_cu,'total_orders_unified',total_orders,
        'first_purchase_at',first_purchase_at,'rfm_segment',rfm_segment,
        'acquisition_origins',source_origins,
        'lp_leads_tags',lp_tags,'event_leads_sources',ev_srcs,
        'prior_catalog_reg',prior_catalog_reg,'in_chat_contacts',in_chat,'in_zoppy',in_zoppy)
    ) AS row, bucket, value
    FROM classified WHERE kind='buyer'
  ),
  non_buyer_rows AS (
    SELECT jsonb_build_object(
      'phone_key',pkey,'name',COALESCE(cu_name,'(sem nome)'),
      'instagram',COALESCE(NULLIF(instagram,''),cu_ig),
      'bucket',bucket,'reason',reason,'last_activity_at',created_at,
      'sources',jsonb_build_object(
        'prior_sales',prior_sales,'first_prior_at',first_prior_at,
        'in_customers_unified',in_cu,'total_orders_unified',total_orders,
        'first_purchase_at',first_purchase_at,'rfm_segment',rfm_segment,
        'acquisition_origins',source_origins,
        'lp_leads_tags',lp_tags,'event_leads_sources',ev_srcs,
        'prior_catalog_reg',prior_catalog_reg,'in_chat_contacts',in_chat,'in_zoppy',in_zoppy)
    ) AS row, bucket, reason
    FROM classified WHERE kind='non_buyer'
  )
  SELECT jsonb_build_object(
    'buyers', jsonb_build_object(
      'total',(SELECT count(*) FROM buyer_rows),
      'lead_first_purchase',(SELECT count(*) FROM buyer_rows WHERE bucket='lead_first_purchase'),
      'existing_customers',(SELECT count(*) FROM buyer_rows WHERE bucket='existing_customer'),
      'brand_new',(SELECT count(*) FROM buyer_rows WHERE bucket='brand_new'),
      'revenue',COALESCE((SELECT sum(value) FROM buyer_rows),0)),
    'non_buyers', jsonb_build_object(
      'total',(SELECT count(*) FROM non_buyer_rows),
      'lead_first_purchase',(SELECT count(*) FROM non_buyer_rows WHERE bucket='lead_first_purchase'),
      'existing_customers',(SELECT count(*) FROM non_buyer_rows WHERE bucket='existing_customer'),
      'brand_new',(SELECT count(*) FROM non_buyer_rows WHERE bucket='brand_new'),
      'by_reason',(SELECT jsonb_object_agg(reason,n) FROM (SELECT reason,count(*) n FROM non_buyer_rows GROUP BY reason) t)),
    'buyer_list',COALESCE((SELECT jsonb_agg(row) FROM buyer_rows),'[]'::jsonb),
    'non_buyer_list',COALESCE((SELECT jsonb_agg(row) FROM non_buyer_rows),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END; $function$;
