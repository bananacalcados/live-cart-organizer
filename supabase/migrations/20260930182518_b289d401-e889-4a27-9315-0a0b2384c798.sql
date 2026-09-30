CREATE OR REPLACE FUNCTION public.participant_score_ranking(p_handles text[] DEFAULT NULL::text[])
 RETURNS TABLE(handle text, comment_count integer, live_count integer, paid_orders integer, cancelled_orders integer, total_spent numeric, avg_ticket numeric, last_participation timestamp with time zone, live_dates text[], score integer, category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH hs AS (
    SELECT array_agg(DISTINCT lower(regexp_replace(x, '^@', ''))) AS a FROM unnest(p_handles) x
  ),
  comments AS (
    SELECT lower(regexp_replace(username, '^@', '')) AS h, created_at
    FROM public.live_comments, hs
    WHERE username IS NOT NULL AND username <> ''
      AND (p_handles IS NULL OR lower(regexp_replace(username, '^@', '')) = ANY(hs.a))
    UNION ALL
    SELECT lower(regexp_replace(sender_name, '^@', '')) AS h, created_at
    FROM public.whatsapp_messages, hs
    WHERE channel = 'instagram'
      AND direction = 'incoming'
      AND message ILIKE '💬 Comentário no Live:%'
      AND sender_name LIKE '@%'
      AND (p_handles IS NULL OR sender_name = ANY(SELECT '@' || y FROM unnest(hs.a) y))
  ),
  comm_agg AS (
    SELECT h, count(*)::int AS comment_count,
      count(DISTINCT date(created_at))::int AS live_count,
      max(created_at) AS last_participation,
      (array_agg(DISTINCT to_char(created_at, 'DD/MM/YYYY') ORDER BY to_char(created_at, 'DD/MM/YYYY') DESC))[1:30] AS live_dates
    FROM comments WHERE h <> '' GROUP BY h
  ),
  cust AS (
    SELECT c.id, lower(regexp_replace(c.instagram_handle, '^@', '')) AS h
    FROM public.customers c, hs
    WHERE c.instagram_handle IS NOT NULL AND c.instagram_handle <> ''
      AND (p_handles IS NULL OR lower(regexp_replace(c.instagram_handle, '^@', '')) = ANY(hs.a))
  ),
  ord_agg AS (
    SELECT cu.h,
      count(*) FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))::int AS paid_orders,
      count(*) FILTER (WHERE o.stage = 'cancelled')::int AS cancelled_orders,
      COALESCE(SUM(public.bc_order_total(o.products, o.discount_type, o.discount_value))
        FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])), 0) AS total_spent
    FROM public.orders o JOIN cust cu ON cu.id = o.customer_id
    GROUP BY 1
  ),
  merged AS (
    SELECT COALESCE(ca.h, oa.h) AS handle,
      COALESCE(ca.comment_count, 0) AS comment_count, COALESCE(ca.live_count, 0) AS live_count,
      COALESCE(oa.paid_orders, 0) AS paid_orders, COALESCE(oa.cancelled_orders, 0) AS cancelled_orders,
      COALESCE(oa.total_spent, 0) AS total_spent, ca.last_participation,
      COALESCE(ca.live_dates, ARRAY[]::text[]) AS live_dates
    FROM comm_agg ca FULL OUTER JOIN ord_agg oa ON oa.h = ca.h
    WHERE COALESCE(ca.h, oa.h) <> ''
  ),
  scored AS (
    SELECT handle, comment_count, live_count, paid_orders, cancelled_orders, total_spent,
      CASE WHEN paid_orders > 0 THEN round(total_spent / paid_orders, 2) ELSE 0 END AS avg_ticket,
      last_participation, live_dates,
      (live_count * 5 + LEAST(comment_count, 50) + paid_orders * 30 + floor(total_spent / 50)::int - cancelled_orders * 10)::int AS score
    FROM merged
  )
  SELECT handle, comment_count, live_count, paid_orders, cancelled_orders, total_spent, avg_ticket,
    last_participation, live_dates, GREATEST(score, 0) AS score,
    CASE WHEN GREATEST(score, 0) >= 150 THEN 'vip' WHEN GREATEST(score, 0) >= 70 THEN 'engajado'
         WHEN GREATEST(score, 0) >= 25 THEN 'ativo' ELSE 'frio' END AS category
  FROM scored
  ORDER BY score DESC, last_participation DESC NULLS LAST
$function$;
CREATE INDEX IF NOT EXISTS idx_live_comments_username_norm ON public.live_comments (lower(regexp_replace(username, '^@', '')));
CREATE INDEX IF NOT EXISTS idx_customers_ig_lower_strip ON public.customers (lower(regexp_replace(instagram_handle, '^@', '')));
CREATE INDEX IF NOT EXISTS idx_wm_ig_sender_incoming ON public.whatsapp_messages (sender_name) WHERE channel = 'instagram' AND direction = 'incoming';