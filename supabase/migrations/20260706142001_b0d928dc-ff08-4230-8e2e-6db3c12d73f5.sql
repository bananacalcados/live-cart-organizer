-- 1) Rótulo/origem opcional por link (atribuição por campanha/origem)
ALTER TABLE public.group_redirect_links
  ADD COLUMN IF NOT EXISTS label text;

-- 2) RPC: funil por link de Grupo VIP.
--    Números CRUS e SEPARADOS: cliques (por link) e entradas (por grupo/webhook).
--    A atribuição de entradas por link é ESTIMADA por proporção de cliques.
CREATE OR REPLACE FUNCTION public.vip_link_funnel(p_days integer DEFAULT 30)
RETURNS TABLE (
  link_id uuid,
  slug text,
  label text,
  campaign_id uuid,
  campaign_name text,
  group_names text[],
  clicks integer,              -- REAL: cliques neste link específico
  campaign_clicks integer,     -- REAL: soma de cliques de todos os links da campanha
  redirect_count integer,      -- REAL: redirecionamentos concluídos deste link
  group_entries integer,       -- REAL: entradas confirmadas no(s) grupo(s) (webhook)
  estimated_entries integer,   -- ESTIMATIVA: cliques/cliques_campanha * entradas_grupo
  leads_created integer,       -- REAL: entradas que NÃO são clientes (viraram lead)
  customers_tagged integer     -- REAL: entradas que já eram clientes (só tagueados)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH links AS (
    SELECT l.id, l.slug, l.label, l.campaign_id, l.click_count, l.redirect_count
    FROM group_redirect_links l
    WHERE l.is_active = true
  ),
  camp_clicks AS (
    SELECT campaign_id, COALESCE(SUM(click_count), 0)::int AS cc
    FROM group_redirect_links
    WHERE is_active = true
    GROUP BY campaign_id
  ),
  -- grupos de cada campanha, normalizados por dígitos (mesmo grupo em várias instâncias)
  cg AS (
    SELECT gc.id AS campaign_id,
           gc.name AS campaign_name,
           regexp_replace(wg.group_id, '\D', '', 'g') AS gdig,
           wg.name AS gname
    FROM group_campaigns gc
    JOIN whatsapp_groups wg ON wg.id = ANY (gc.target_groups)
  ),
  cg_d AS (
    SELECT DISTINCT campaign_id, gdig FROM cg WHERE gdig <> ''
  ),
  gnames AS (
    SELECT campaign_id, array_agg(DISTINCT gname) FILTER (WHERE gname IS NOT NULL) AS names
    FROM cg GROUP BY campaign_id
  ),
  -- entradas confirmadas (estado atual de membros, não-internos, entrados no período)
  entries AS (
    SELECT cg_d.campaign_id,
      COUNT(m.id)::int AS group_entries,
      COUNT(m.id) FILTER (WHERE m.customer_id IS NOT NULL)::int AS customers_tagged,
      COUNT(m.id) FILTER (WHERE m.customer_id IS NULL)::int AS leads_created
    FROM cg_d
    LEFT JOIN whatsapp_group_members m
      ON m.group_id = cg_d.gdig
     AND m.is_internal = false
     AND m.status = 'member'
     AND COALESCE(m.joined_at, m.last_event_at) >= now() - make_interval(days => p_days)
    GROUP BY cg_d.campaign_id
  )
  SELECT
    l.id,
    l.slug,
    l.label,
    l.campaign_id,
    gc0.name,
    COALESCE(gn.names, ARRAY[]::text[]),
    COALESCE(l.click_count, 0),
    COALESCE(cc.cc, 0),
    COALESCE(l.redirect_count, 0),
    COALESCE(e.group_entries, 0),
    CASE WHEN COALESCE(cc.cc, 0) > 0
      THEN ROUND(l.click_count::numeric / cc.cc * COALESCE(e.group_entries, 0))::int
      ELSE 0 END,
    COALESCE(e.leads_created, 0),
    COALESCE(e.customers_tagged, 0)
  FROM links l
  JOIN group_campaigns gc0 ON gc0.id = l.campaign_id
  LEFT JOIN camp_clicks cc ON cc.campaign_id = l.campaign_id
  LEFT JOIN gnames gn ON gn.campaign_id = l.campaign_id
  LEFT JOIN entries e ON e.campaign_id = l.campaign_id
  ORDER BY l.click_count DESC NULLS LAST, l.slug;
$$;

GRANT EXECUTE ON FUNCTION public.vip_link_funnel(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vip_link_funnel(integer) TO service_role;