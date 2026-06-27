
-- ════════════════════════════════════════════════════════════════════
-- Dashboard consolidado de Grupos VIP (Lead Scoring global). Aditivo.
-- ════════════════════════════════════════════════════════════════════

-- 1) Visão geral / totais
CREATE OR REPLACE FUNCTION public.vip_groups_overview()
RETURNS TABLE (
  total_groups bigint,
  total_members bigint,
  total_memberships bigint,
  total_activities bigint,
  groups_with_activity bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM whatsapp_groups WHERE is_active),
    (SELECT count(DISTINCT phone) FROM whatsapp_group_members WHERE status = 'member' AND NOT is_internal),
    (SELECT count(*) FROM whatsapp_group_members WHERE status = 'member' AND NOT is_internal),
    (SELECT count(*) FROM whatsapp_group_member_activity WHERE NOT is_internal),
    (SELECT count(DISTINCT regexp_replace(group_id, '\D', '', 'g')) FROM whatsapp_group_member_activity WHERE NOT is_internal);
$$;

-- 2) Ranking de grupos por interação
CREATE OR REPLACE FUNCTION public.vip_groups_interaction_ranking(p_days int DEFAULT 90)
RETURNS TABLE (
  group_id text,
  name text,
  photo_url text,
  member_count bigint,
  poll_votes bigint,
  messages bigint,
  reactions bigint,
  total_activities bigint,
  active_members bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH act AS (
    SELECT regexp_replace(group_id, '\D', '', 'g') AS gid,
      count(*) FILTER (WHERE activity_type = 'poll_vote')     AS pv,
      count(*) FILTER (WHERE activity_type = 'group_message') AS ms,
      count(*) FILTER (WHERE activity_type = 'reaction')      AS rc,
      count(*)                                                AS total,
      count(DISTINCT phone)                                   AS am
    FROM whatsapp_group_member_activity
    WHERE NOT is_internal
      AND created_at > now() - (p_days || ' days')::interval
    GROUP BY 1
  ),
  mem AS (
    SELECT regexp_replace(group_id, '\D', '', 'g') AS gid, count(DISTINCT phone) AS mc
    FROM whatsapp_group_members
    WHERE status = 'member' AND NOT is_internal
    GROUP BY 1
  )
  SELECT
    g.group_id, g.name, g.photo_url,
    COALESCE(mem.mc, 0), COALESCE(act.pv, 0), COALESCE(act.ms, 0),
    COALESCE(act.rc, 0), COALESCE(act.total, 0), COALESCE(act.am, 0)
  FROM whatsapp_groups g
  LEFT JOIN act ON act.gid = regexp_replace(g.group_id, '\D', '', 'g')
  LEFT JOIN mem ON mem.gid = regexp_replace(g.group_id, '\D', '', 'g')
  WHERE g.is_active
  ORDER BY COALESCE(act.total, 0) DESC, COALESCE(mem.mc, 0) DESC;
$$;

-- 3) Ranking de grupos que mais geram venda (janela de atribuição em dias)
CREATE OR REPLACE FUNCTION public.vip_groups_sales_ranking(p_window_days int DEFAULT 14, p_days int DEFAULT 90)
RETURNS TABLE (
  group_id text,
  name text,
  photo_url text,
  buyers bigint,
  sales_count bigint,
  revenue numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH act AS (
    SELECT DISTINCT
      regexp_replace(group_id, '\D', '', 'g')          AS gid,
      right(regexp_replace(phone, '\D', '', 'g'), 8)   AS suffix8,
      created_at
    FROM whatsapp_group_member_activity
    WHERE NOT is_internal
      AND created_at > now() - (p_days || ' days')::interval
      AND length(regexp_replace(phone, '\D', '', 'g')) >= 8
  ),
  matched AS (
    SELECT a.gid, s.id AS sale_id, s.total, s.customer_phone
    FROM act a
    JOIN pos_sales s
      ON right(regexp_replace(s.customer_phone, '\D', '', 'g'), 8) = a.suffix8
     AND s.created_at >= a.created_at
     AND s.created_at <= a.created_at + (p_window_days || ' days')::interval
    WHERE s.customer_phone IS NOT NULL
  ),
  dedup AS (
    SELECT DISTINCT gid, sale_id, total, right(regexp_replace(customer_phone, '\D', '', 'g'), 8) AS buyer
    FROM matched
  ),
  agg AS (
    SELECT gid,
      count(DISTINCT buyer)   AS buyers,
      count(DISTINCT sale_id) AS sales_count,
      COALESCE(sum(total), 0) AS revenue
    FROM dedup
    GROUP BY gid
  )
  SELECT g.group_id, g.name, g.photo_url, agg.buyers, agg.sales_count, agg.revenue
  FROM agg
  JOIN whatsapp_groups g ON regexp_replace(g.group_id, '\D', '', 'g') = agg.gid
  WHERE g.is_active
  ORDER BY agg.revenue DESC, agg.sales_count DESC;
$$;

-- 4) Ranking de leads (pessoas) por interação + origem
CREATE OR REPLACE FUNCTION public.vip_leads_ranking(p_limit int DEFAULT 50, p_days int DEFAULT 90)
RETURNS TABLE (
  phone text,
  display_name text,
  customer_id uuid,
  customer_name text,
  source_origins jsonb,
  groups_count bigint,
  poll_votes bigint,
  messages bigint,
  reactions bigint,
  total_activities bigint,
  last_activity_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH act AS (
    SELECT
      right(regexp_replace(phone, '\D', '', 'g'), 8)         AS suffix8,
      max(phone)                                             AS raw_phone,
      max(display_name)                                      AS display_name,
      count(DISTINCT regexp_replace(group_id, '\D', '', 'g')) AS groups_count,
      count(*) FILTER (WHERE activity_type = 'poll_vote')     AS pv,
      count(*) FILTER (WHERE activity_type = 'group_message') AS ms,
      count(*) FILTER (WHERE activity_type = 'reaction')      AS rc,
      count(*)                                               AS total,
      max(created_at)                                        AS last_at
    FROM whatsapp_group_member_activity
    WHERE NOT is_internal
      AND created_at > now() - (p_days || ' days')::interval
      AND length(regexp_replace(phone, '\D', '', 'g')) >= 8
    GROUP BY 1
  )
  SELECT
    a.raw_phone, a.display_name,
    c.id, c.name, c.source_origins,
    a.groups_count, a.pv, a.ms, a.rc, a.total, a.last_at
  FROM act a
  LEFT JOIN LATERAL (
    SELECT id, name, source_origins
    FROM customers_unified
    WHERE phone_suffix8 = a.suffix8 AND NOT COALESCE(is_archived, false)
    ORDER BY total_orders DESC NULLS LAST
    LIMIT 1
  ) c ON true
  ORDER BY a.total DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.vip_groups_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vip_groups_interaction_ranking(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vip_groups_sales_ranking(int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vip_leads_ranking(int, int) TO authenticated, service_role;
