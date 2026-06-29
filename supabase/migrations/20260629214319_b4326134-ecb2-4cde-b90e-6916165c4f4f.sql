-- ============ Helper: phone key (DDD + last 8 digits, drops DDI/9) ============
CREATE OR REPLACE FUNCTION public.bc_phone_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH d AS (
    SELECT regexp_replace(COALESCE(p, ''), '\D', '', 'g') AS digits
  ), s AS (
    SELECT CASE WHEN length(digits) > 11 THEN right(digits, 11) ELSE digits END AS digits FROM d
  )
  SELECT CASE
    WHEN length(digits) >= 10 THEN left(digits, 2) || right(digits, 8)
    ELSE digits
  END
  FROM s
$$;

-- ============ Helper: order total from products jsonb + discount ============
CREATE OR REPLACE FUNCTION public.bc_order_total(products jsonb, discount_type text, discount_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH sub AS (
    SELECT COALESCE(SUM(
      (COALESCE((p->>'price')::numeric, 0)) * (COALESCE((p->>'quantity')::numeric, 0))
    ), 0) AS subtotal
    FROM jsonb_array_elements(COALESCE(products, '[]'::jsonb)) p
  )
  SELECT GREATEST(0,
    CASE
      WHEN discount_type = 'percentage' AND discount_value IS NOT NULL
        THEN subtotal - subtotal * (discount_value / 100.0)
      WHEN discount_type IS NOT NULL AND discount_value IS NOT NULL
        THEN subtotal - discount_value
      ELSE subtotal
    END
  )
  FROM sub
$$;

-- ============ RPC: event_inner_dashboard ============
CREATE OR REPLACE FUNCTION public.event_inner_dashboard(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_orders int := 0;
  v_paid_orders int := 0;
  v_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_crossell_added int := 0;
  v_crossell_converted int := 0;
  v_leads_total int := 0;
  v_leads_lp int := 0;
  v_leads_typebot int := 0;
  v_leads_converted int := 0;
  v_conversion numeric := 0;
BEGIN
  -- Orders metrics
  SELECT
    count(*),
    count(*) FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])),
    COALESCE(SUM(public.bc_order_total(o.products, o.discount_type, o.discount_value))
      FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])), 0)
  INTO v_total_orders, v_paid_orders, v_revenue
  FROM public.orders o
  WHERE o.event_id = p_event_id;

  IF v_paid_orders > 0 THEN
    v_avg_ticket := v_revenue / v_paid_orders;
  END IF;

  -- Crossell items added + converted (paid order)
  SELECT
    COALESCE(SUM(ci.qty), 0),
    COALESCE(SUM(ci.qty) FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])), 0)
  INTO v_crossell_added, v_crossell_converted
  FROM public.order_crossell_items ci
  JOIN public.orders o ON o.id = ci.order_id
  WHERE ci.event_id = p_event_id;

  -- Leads captured for this event
  SELECT
    count(*),
    count(*) FILTER (WHERE source = 'lp'),
    count(*) FILTER (WHERE source = 'typebot')
  INTO v_leads_total, v_leads_lp, v_leads_typebot
  FROM public.event_leads
  WHERE event_id = p_event_id;

  -- Leads that converted into a PAID order in this event (match by phone key)
  SELECT count(DISTINCT lk.k)
  INTO v_leads_converted
  FROM (
    SELECT DISTINCT public.bc_phone_key(phone) AS k
    FROM public.event_leads
    WHERE event_id = p_event_id AND phone IS NOT NULL
  ) lk
  WHERE lk.k <> '' AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE o.event_id = p_event_id
      AND (o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))
      AND public.bc_phone_key(c.whatsapp) = lk.k
  );

  IF v_leads_total > 0 THEN
    v_conversion := round((v_leads_converted::numeric / v_leads_total) * 100, 1);
  END IF;

  RETURN jsonb_build_object(
    'total_orders', v_total_orders,
    'paid_orders', v_paid_orders,
    'revenue', v_revenue,
    'avg_ticket', round(v_avg_ticket, 2),
    'crossell_added', v_crossell_added,
    'crossell_converted', v_crossell_converted,
    'leads_total', v_leads_total,
    'leads_lp', v_leads_lp,
    'leads_typebot', v_leads_typebot,
    'leads_converted', v_leads_converted,
    'conversion_rate', v_conversion
  );
END;
$$;

-- ============ RPC: match_event_leads ============
-- Given a list of phone-ish strings, returns which keys are leads of this event
-- and which exist as leads in OTHER events / marketing campaigns.
CREATE OR REPLACE FUNCTION public.match_event_leads(p_event_id uuid, p_phones text[])
RETURNS TABLE(phone_key text, this_event boolean, other_event boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH keys AS (
    SELECT DISTINCT public.bc_phone_key(x) AS k
    FROM unnest(COALESCE(p_phones, ARRAY[]::text[])) x
    WHERE public.bc_phone_key(x) <> ''
  )
  SELECT
    k AS phone_key,
    EXISTS (
      SELECT 1 FROM public.event_leads l
      WHERE l.event_id = p_event_id AND public.bc_phone_key(l.phone) = k
    ) AS this_event,
    EXISTS (
      SELECT 1 FROM public.event_leads l
      WHERE l.event_id <> p_event_id AND public.bc_phone_key(l.phone) = k
    ) AS other_event
  FROM keys
$$;

-- ============ RPC: participant_score_ranking ============
CREATE OR REPLACE FUNCTION public.participant_score_ranking(p_handles text[] DEFAULT NULL)
RETURNS TABLE(
  handle text,
  comment_count int,
  live_count int,
  paid_orders int,
  cancelled_orders int,
  total_spent numeric,
  avg_ticket numeric,
  last_participation timestamptz,
  live_dates text[],
  score int,
  category text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH comments AS (
    -- live_comments (event-tagged)
    SELECT lower(regexp_replace(username, '^@', '')) AS h, created_at
    FROM public.live_comments
    WHERE username IS NOT NULL AND username <> ''
    UNION ALL
    -- whatsapp_messages live comments (instagram)
    SELECT lower(regexp_replace(sender_name, '^@', '')) AS h, created_at
    FROM public.whatsapp_messages
    WHERE channel = 'instagram'
      AND direction = 'incoming'
      AND message ILIKE '💬 Comentário no Live:%'
      AND sender_name LIKE '@%'
  ),
  comm_agg AS (
    SELECT
      h,
      count(*)::int AS comment_count,
      count(DISTINCT date(created_at))::int AS live_count,
      max(created_at) AS last_participation,
      (array_agg(DISTINCT to_char(created_at, 'DD/MM/YYYY') ORDER BY to_char(created_at, 'DD/MM/YYYY') DESC))[1:30] AS live_dates
    FROM comments
    WHERE h <> ''
    GROUP BY h
  ),
  ord_agg AS (
    SELECT
      lower(regexp_replace(c.instagram_handle, '^@', '')) AS h,
      count(*) FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))::int AS paid_orders,
      count(*) FILTER (WHERE o.stage = 'cancelled')::int AS cancelled_orders,
      COALESCE(SUM(public.bc_order_total(o.products, o.discount_type, o.discount_value))
        FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])), 0) AS total_spent
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE c.instagram_handle IS NOT NULL AND c.instagram_handle <> ''
    GROUP BY 1
  ),
  merged AS (
    SELECT
      COALESCE(ca.h, oa.h) AS handle,
      COALESCE(ca.comment_count, 0) AS comment_count,
      COALESCE(ca.live_count, 0) AS live_count,
      COALESCE(oa.paid_orders, 0) AS paid_orders,
      COALESCE(oa.cancelled_orders, 0) AS cancelled_orders,
      COALESCE(oa.total_spent, 0) AS total_spent,
      ca.last_participation,
      COALESCE(ca.live_dates, ARRAY[]::text[]) AS live_dates
    FROM comm_agg ca
    FULL OUTER JOIN ord_agg oa ON oa.h = ca.h
    WHERE COALESCE(ca.h, oa.h) <> ''
  ),
  scored AS (
    SELECT
      handle,
      comment_count,
      live_count,
      paid_orders,
      cancelled_orders,
      total_spent,
      CASE WHEN paid_orders > 0 THEN round(total_spent / paid_orders, 2) ELSE 0 END AS avg_ticket,
      last_participation,
      live_dates,
      (live_count * 5
        + LEAST(comment_count, 50)
        + paid_orders * 30
        + floor(total_spent / 50)::int
        - cancelled_orders * 10)::int AS score
    FROM merged
  )
  SELECT
    handle,
    comment_count,
    live_count,
    paid_orders,
    cancelled_orders,
    total_spent,
    avg_ticket,
    last_participation,
    live_dates,
    GREATEST(score, 0) AS score,
    CASE
      WHEN GREATEST(score, 0) >= 150 THEN 'vip'
      WHEN GREATEST(score, 0) >= 70 THEN 'engajado'
      WHEN GREATEST(score, 0) >= 25 THEN 'ativo'
      ELSE 'frio'
    END AS category
  FROM scored
  WHERE (p_handles IS NULL OR handle = ANY(SELECT lower(regexp_replace(x, '^@', '')) FROM unnest(p_handles) x))
  ORDER BY score DESC, last_participation DESC NULLS LAST
$$;

-- ============ Grants ============
GRANT EXECUTE ON FUNCTION public.bc_phone_key(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.bc_order_total(jsonb, text, numeric) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.event_inner_dashboard(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_event_leads(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.participant_score_ranking(text[]) TO authenticated, service_role;