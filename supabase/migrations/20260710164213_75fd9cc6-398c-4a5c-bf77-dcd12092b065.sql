
-- ════════════════════════════════════════════════════════════════════
-- BASE DE ÓRFÃOS DE GRUPOS VIP — camada de dados
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

-- ── 1) Classificação de um telefone ──
CREATE OR REPLACE FUNCTION public.classify_group_member(_phone text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT right(regexp_replace(coalesce(_phone,''),'\D','','g'),8) AS s8)
  SELECT CASE
    WHEN (SELECT length(s8) FROM s) < 8 THEN 'invalid'
    WHEN EXISTS (SELECT 1 FROM public.customers_unified c, s WHERE c.phone_suffix8 = s.s8) THEN 'customer'
    WHEN EXISTS (SELECT 1 FROM public.event_leads e, s WHERE right(regexp_replace(coalesce(e.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.lp_leads l, s WHERE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.ad_leads a, s WHERE right(regexp_replace(coalesce(a.phone,''),'\D','','g'),8) = s.s8)
      OR EXISTS (SELECT 1 FROM public.link_page_leads k, s WHERE right(regexp_replace(coalesce(k.phone,''),'\D','','g'),8) = s.s8)
      THEN 'lead'
    ELSE 'orphan'
  END;
$$;
GRANT EXECUTE ON FUNCTION public.classify_group_member(text) TO authenticated, service_role;

-- ── 2) Tabela base de órfãos ──
CREATE TABLE public.vip_orphan_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,
  phone_suffix8 text NOT NULL,
  display_name  text,
  group_ids     text[] NOT NULL DEFAULT '{}',
  group_names   text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'orphan',
  opted_out     boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vip_orphan_contacts_phone_suffix8_key UNIQUE (phone_suffix8)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vip_orphan_contacts TO authenticated;
GRANT ALL ON public.vip_orphan_contacts TO service_role;
ALTER TABLE public.vip_orphan_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team manage vip_orphan_contacts"
  ON public.vip_orphan_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_vip_orphan_contacts_updated_at
  BEFORE UPDATE ON public.vip_orphan_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_vip_orphan_contacts_status ON public.vip_orphan_contacts(status);

-- ── 3) Campanhas de disparo em massa ──
CREATE TABLE public.mass_dispatch_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  message            text,
  audience_filters   jsonb NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_number_id uuid,
  status             text NOT NULL DEFAULT 'draft',
  attribution_days   integer NOT NULL DEFAULT 7,
  total_targets      integer NOT NULL DEFAULT 0,
  sent_count         integer NOT NULL DEFAULT 0,
  failed_count       integer NOT NULL DEFAULT 0,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mass_dispatch_campaigns TO authenticated;
GRANT ALL ON public.mass_dispatch_campaigns TO service_role;
ALTER TABLE public.mass_dispatch_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team manage mass_dispatch_campaigns"
  ON public.mass_dispatch_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_mass_dispatch_campaigns_updated_at
  BEFORE UPDATE ON public.mass_dispatch_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4) Destinatários ──
CREATE TABLE public.mass_dispatch_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.mass_dispatch_campaigns(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.vip_orphan_contacts(id) ON DELETE SET NULL,
  phone         text NOT NULL,
  phone_suffix8 text NOT NULL,
  display_name  text,
  status        text NOT NULL DEFAULT 'pending',
  message_id    text,
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mass_dispatch_targets_unique UNIQUE (campaign_id, phone_suffix8)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mass_dispatch_targets TO authenticated;
GRANT ALL ON public.mass_dispatch_targets TO service_role;
ALTER TABLE public.mass_dispatch_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team manage mass_dispatch_targets"
  ON public.mass_dispatch_targets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_mass_dispatch_targets_updated_at
  BEFORE UPDATE ON public.mass_dispatch_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_mass_dispatch_targets_campaign ON public.mass_dispatch_targets(campaign_id);
CREATE INDEX idx_mass_dispatch_targets_status ON public.mass_dispatch_targets(status);

-- ── 5) Visão de contagem por grupo VIP ──
CREATE OR REPLACE VIEW public.vip_group_membership_stats
WITH (security_invoker = on) AS
WITH vip_group_ids AS (
  SELECT DISTINCT unnest(target_groups) AS gid FROM public.group_campaigns
),
vip_groups AS (
  SELECT g.id, g.name, regexp_replace(g.group_id,'\D','','g') AS digits
  FROM public.whatsapp_groups g JOIN vip_group_ids v ON v.gid = g.id
),
member_class AS (
  SELECT DISTINCT
    regexp_replace(m.group_id,'\D','','g') AS digits,
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

-- ── 6) Função de refresh ──
CREATE OR REPLACE FUNCTION public.refresh_vip_orphans()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted int; v_promoted int; v_total int;
BEGIN
  WITH vip_group_ids AS (
    SELECT DISTINCT unnest(target_groups) AS gid FROM public.group_campaigns
  ),
  vip_groups AS (
    SELECT g.id, g.name, regexp_replace(g.group_id,'\D','','g') AS digits
    FROM public.whatsapp_groups g JOIN vip_group_ids v ON v.gid = g.id
  ),
  member_rows AS (
    SELECT right(regexp_replace(m.phone,'\D','','g'),8) AS s8,
           regexp_replace(m.phone,'\D','','g') AS phone_full,
           m.display_name, m.customer_id,
           regexp_replace(m.group_id,'\D','','g') AS digits
    FROM public.whatsapp_group_members m
    WHERE length(regexp_replace(m.phone,'\D','','g')) >= 12
  ),
  joined AS (
    SELECT mr.s8, mr.phone_full, mr.display_name, mr.customer_id,
           vg.id::text AS group_uuid, vg.name AS group_name
    FROM member_rows mr JOIN vip_groups vg ON vg.digits = mr.digits
  ),
  agg AS (
    SELECT s8,
      (array_agg(phone_full ORDER BY length(phone_full) DESC))[1] AS phone,
      (array_agg(display_name) FILTER (WHERE display_name IS NOT NULL AND display_name <> ''))[1] AS display_name,
      array_agg(DISTINCT group_uuid) AS group_ids,
      array_agg(DISTINCT group_name) AS group_names,
      bool_or(customer_id IS NOT NULL) AS has_customer_id
    FROM joined GROUP BY s8
  ),
  classified AS (
    SELECT a.*,
      CASE
        WHEN a.has_customer_id THEN 'customer'
        WHEN EXISTS (SELECT 1 FROM public.customers_unified c WHERE c.phone_suffix8 = a.s8) THEN 'customer'
        WHEN EXISTS (SELECT 1 FROM public.event_leads e WHERE right(regexp_replace(coalesce(e.phone,''),'\D','','g'),8) = a.s8)
          OR EXISTS (SELECT 1 FROM public.lp_leads l WHERE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),8) = a.s8)
          OR EXISTS (SELECT 1 FROM public.ad_leads ad WHERE right(regexp_replace(coalesce(ad.phone,''),'\D','','g'),8) = a.s8)
          OR EXISTS (SELECT 1 FROM public.link_page_leads k WHERE right(regexp_replace(coalesce(k.phone,''),'\D','','g'),8) = a.s8)
          THEN 'lead'
        ELSE 'orphan'
      END AS klass
    FROM agg a
  )
  INSERT INTO public.vip_orphan_contacts
    (phone, phone_suffix8, display_name, group_ids, group_names, status, last_seen_at)
  SELECT c.phone, c.s8, c.display_name, c.group_ids, c.group_names, 'orphan', now()
  FROM classified c WHERE c.klass = 'orphan'
  ON CONFLICT (phone_suffix8) DO UPDATE SET
    phone        = EXCLUDED.phone,
    display_name = COALESCE(public.vip_orphan_contacts.display_name, EXCLUDED.display_name),
    group_ids    = EXCLUDED.group_ids,
    group_names  = EXCLUDED.group_names,
    last_seen_at = now(),
    status       = CASE WHEN public.vip_orphan_contacts.opted_out THEN 'opted_out' ELSE 'orphan' END;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.vip_orphan_contacts o
  SET status = 'promoted'
  WHERE o.status = 'orphan' AND public.classify_group_member(o.phone) IN ('customer','lead');
  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  SELECT count(*) INTO v_total FROM public.vip_orphan_contacts WHERE status = 'orphan';
  RETURN jsonb_build_object('upserted', v_inserted, 'promoted', v_promoted, 'active_orphans', v_total);
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_vip_orphans() TO authenticated, service_role;

-- ── 7) Visão de ROAS ──
CREATE OR REPLACE VIEW public.mass_dispatch_roas
WITH (security_invoker = on) AS
WITH sent AS (
  SELECT t.campaign_id, t.phone_suffix8, t.sent_at, c.attribution_days
  FROM public.mass_dispatch_targets t
  JOIN public.mass_dispatch_campaigns c ON c.id = t.campaign_id
  WHERE t.status = 'sent' AND t.sent_at IS NOT NULL
),
sales AS (
  SELECT right(regexp_replace(coalesce(s.customer_phone,''),'\D','','g'),8) AS s8,
         s.created_at, s.total
  FROM public.pos_sales s
  WHERE s.customer_phone IS NOT NULL
    AND s.status IN ('completed','paid','pending_pickup','pending_sync')
),
attributed AS (
  SELECT DISTINCT s.campaign_id, sa.s8, sa.total, sa.created_at
  FROM sent s
  JOIN sales sa ON sa.s8 = s.phone_suffix8
   AND sa.created_at >= s.sent_at
   AND sa.created_at <= s.sent_at + (s.attribution_days || ' days')::interval
)
SELECT
  c.id AS campaign_id, c.name, c.sent_count,
  count(DISTINCT a.s8) AS buyers,
  COALESCE(sum(a.total), 0) AS attributed_revenue,
  CASE WHEN count(DISTINCT a.s8) > 0 THEN COALESCE(sum(a.total),0) / count(DISTINCT a.s8) END AS avg_ticket,
  CASE WHEN c.sent_count > 0 THEN round(count(DISTINCT a.s8)::numeric / c.sent_count * 100, 2) END AS conversion_rate
FROM public.mass_dispatch_campaigns c
LEFT JOIN attributed a ON a.campaign_id = c.id
GROUP BY c.id, c.name, c.sent_count;
GRANT SELECT ON public.mass_dispatch_roas TO authenticated, service_role;
