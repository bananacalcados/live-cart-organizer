-- ════════════════════════════════════════════════════════════════════
-- GRUPOS WHATSAPP — ID normalizado (group_jid_base) + visão unificada
--
-- Problema: whatsapp_groups.group_id vem com sufixo (`120363…@g.us` da
-- uazapi/WaSender, `120363…-group` da Z-API) enquanto o rastreio de membros
-- grava só os dígitos. Joins diretos nunca casam (ex.: a RPC
-- vip_group_member_phone_suffixes retornava vazio sempre). Além disso o mesmo
-- grupo lógico aparece em várias linhas (uma por instância nossa no grupo).
--
-- Solução: coluna group_jid_base (só os dígitos antes de `@`/`-`) em todas as
-- tabelas de grupo, preenchida a partir do valor atual e gravada pelas
-- sincronizações daqui em diante. O group_id original é preservado.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Coluna normalizada ──
ALTER TABLE public.whatsapp_groups ADD COLUMN group_jid_base text;
ALTER TABLE public.whatsapp_group_members ADD COLUMN group_jid_base text;
ALTER TABLE public.whatsapp_group_member_events ADD COLUMN group_jid_base text;
ALTER TABLE public.whatsapp_group_member_activity ADD COLUMN group_jid_base text;
ALTER TABLE public.whatsapp_group_snapshots ADD COLUMN group_jid_base text;

-- ── 2) Preenchimento a partir do valor atual ──
UPDATE public.whatsapp_groups
SET group_jid_base = split_part(split_part(group_id, '@', 1), '-', 1)
WHERE group_jid_base IS NULL;

UPDATE public.whatsapp_group_members
SET group_jid_base = split_part(split_part(group_id, '@', 1), '-', 1)
WHERE group_jid_base IS NULL;

UPDATE public.whatsapp_group_member_events
SET group_jid_base = split_part(split_part(group_id, '@', 1), '-', 1)
WHERE group_jid_base IS NULL;

UPDATE public.whatsapp_group_member_activity
SET group_jid_base = split_part(split_part(group_id, '@', 1), '-', 1)
WHERE group_jid_base IS NULL;

-- snapshots referencia a linha do grupo (uuid): herda o base dela
UPDATE public.whatsapp_group_snapshots s
SET group_jid_base = g.group_jid_base
FROM public.whatsapp_groups g
WHERE s.group_id = g.id AND s.group_jid_base IS NULL;

-- ── 3) Índices (todo join/relatório passa a usar group_jid_base) ──
CREATE INDEX idx_whatsapp_groups_jid_base ON public.whatsapp_groups(group_jid_base);
CREATE INDEX idx_whatsapp_group_members_jid_base ON public.whatsapp_group_members(group_jid_base);
CREATE INDEX idx_whatsapp_group_member_events_jid_base ON public.whatsapp_group_member_events(group_jid_base);
CREATE INDEX idx_whatsapp_group_member_activity_jid_base ON public.whatsapp_group_member_activity(group_jid_base);
CREATE INDEX idx_whatsapp_group_snapshots_jid_base ON public.whatsapp_group_snapshots(group_jid_base);

-- ── 4) Visão unificada: uma linha por grupo lógico ──
-- Não apagamos as linhas por instância; a visão agrega. Membros contam cada
-- telefone uma vez por grupo lógico, mesmo visto por mais de uma instância.
CREATE OR REPLACE VIEW public.whatsapp_groups_unified
WITH (security_invoker = on) AS
WITH member_counts AS (
  SELECT group_jid_base,
         count(DISTINCT phone) FILTER (WHERE status = 'member' AND NOT is_internal) AS unique_members
  FROM public.whatsapp_group_members
  WHERE group_jid_base IS NOT NULL
  GROUP BY group_jid_base
)
SELECT
  g.group_jid_base,
  (array_agg(g.id ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC))[1] AS primary_id,
  array_agg(g.id ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC) AS group_row_ids,
  (array_agg(g.name ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC))[1] AS name,
  (array_agg(g.description ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC))[1] AS description,
  (array_agg(g.photo_url ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC))[1] AS photo_url,
  (array_agg(g.participant_count ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC))[1] AS participant_count,
  (array_agg(g.max_participants ORDER BY g.last_synced_at DESC NULLS LAST, g.created_at DESC))[1] AS max_participants,
  array_agg(DISTINCT g.instance_id) FILTER (WHERE g.instance_id IS NOT NULL) AS instance_ids,
  count(*) AS instance_count,
  bool_or(g.is_admin) AS is_admin_any,
  bool_or(g.is_active) AS is_active,
  bool_or(g.is_vip) AS is_vip,
  bool_or(g.is_full) AS is_full,
  COALESCE(mc.unique_members, 0) AS unique_members,
  max(g.last_synced_at) AS last_synced_at,
  min(g.created_at) AS created_at
FROM public.whatsapp_groups g
LEFT JOIN member_counts mc ON mc.group_jid_base = g.group_jid_base
WHERE g.group_jid_base IS NOT NULL
GROUP BY g.group_jid_base, mc.unique_members;

GRANT SELECT ON public.whatsapp_groups_unified TO authenticated, service_role;

-- ── 5) Estatísticas de membros VIP passam a usar o ID normalizado ──
CREATE OR REPLACE VIEW public.vip_group_membership_stats
WITH (security_invoker = on) AS
WITH vip_group_ids AS (
  SELECT DISTINCT unnest(target_groups) AS gid FROM public.group_campaigns
),
vip_groups AS (
  SELECT g.id, g.name, g.group_jid_base AS digits
  FROM public.whatsapp_groups g JOIN vip_group_ids v ON v.gid = g.id
),
member_class AS (
  SELECT DISTINCT
    m.group_jid_base AS digits,
    right(regexp_replace(m.phone,'\D','','g'),8) AS s8,
    CASE
      WHEN m.customer_id IS NOT NULL THEN 'customer'
      WHEN EXISTS (SELECT 1 FROM public.customers_unified c WHERE c.phone_suffix8 = right(regexp_replace(m.phone,'\D','','g'),8)) THEN 'customer'
      WHEN EXISTS (SELECT 1 FROM public.event_leads e WHERE right(regexp_replace(coalesce(e.phone,''),'\D','','g'),8) = right(regexp_replace(m.phone,'\D','','g'),8))
        OR EXISTS (SELECT 1 FROM public.lp_leads l WHERE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),8) = right(regexp_replace(m.phone,'\D','','g'),8))
        OR EXISTS (SELECT 1 FROM public.ad_leads a WHERE right(regexp_replace(coalesce(a.phone,''),'\D','','g'),8) = right(regexp_replace(m.phone,'\D','','g'),8))
        OR EXISTS (SELECT 1 FROM public.link_page_leads k WHERE right(regexp_replace(coalesce(k.phone,''),'\D','','g'),8) = right(regexp_replace(m.phone,'\D','','g'),8))
        THEN 'lead'
      ELSE 'orphan'
    END AS klass
  FROM public.whatsapp_group_members m
  WHERE length(regexp_replace(m.phone,'\D','','g')) >= 12
)
SELECT
  vg.id AS group_id, vg.name AS group_name,
  count(mc.s8) AS total_members,
  count(mc.s8) FILTER (WHERE mc.klass = 'customer') AS customers,
  count(mc.s8) FILTER (WHERE mc.klass = 'lead') AS leads,
  count(mc.s8) FILTER (WHERE mc.klass = 'orphan') AS orphans
FROM vip_groups vg
LEFT JOIN member_class mc ON mc.digits = vg.digits
GROUP BY vg.id, vg.name;
GRANT SELECT ON public.vip_group_membership_stats TO authenticated, service_role;

-- ── 6) Filtro "Grupos VIP" dos disparos: join corrigido (antes nunca casava) ──
CREATE OR REPLACE FUNCTION public.vip_group_member_phone_suffixes()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT right(regexp_replace(m.phone, '\D', '', 'g'), 8)), ARRAY[]::text[])
  FROM public.whatsapp_group_members m
  JOIN public.whatsapp_groups g ON g.group_jid_base = m.group_jid_base
  WHERE g.is_vip = true
    AND m.status = 'member'
    AND m.phone IS NOT NULL
    AND length(regexp_replace(m.phone, '\D', '', 'g')) >= 8;
$$;

REVOKE ALL ON FUNCTION public.vip_group_member_phone_suffixes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vip_group_member_phone_suffixes() TO authenticated, service_role;