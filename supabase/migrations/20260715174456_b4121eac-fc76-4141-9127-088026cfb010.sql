
-- ============================================================================
-- 1) group_message_exposures — observabilidade de grupo (sem bloqueio)
-- ============================================================================
CREATE TABLE public.group_message_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_campaign_message_id uuid REFERENCES public.group_campaign_scheduled_messages(id) ON DELETE CASCADE,
  group_campaign_id uuid REFERENCES public.group_campaigns(id) ON DELETE CASCADE,
  group_jid text NOT NULL,
  group_name text,
  unified_id uuid REFERENCES public.customers_unified(id) ON DELETE SET NULL,
  phone_e164 text,
  phone_suffix8 text,
  member_jid text,
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'group_members_snapshot',  -- 'group_members_snapshot' | 'gap_no_snapshot' | 'manual'
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.group_message_exposures TO authenticated;
GRANT ALL  ON public.group_message_exposures TO service_role;
ALTER TABLE public.group_message_exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read group_message_exposures" ON public.group_message_exposures FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_gme_group_message ON public.group_message_exposures (group_campaign_message_id);
CREATE INDEX idx_gme_unified       ON public.group_message_exposures (unified_id) WHERE unified_id IS NOT NULL;
CREATE INDEX idx_gme_suffix_time   ON public.group_message_exposures (phone_suffix8, snapshotted_at DESC) WHERE phone_suffix8 IS NOT NULL;
CREATE INDEX idx_gme_group_jid     ON public.group_message_exposures (group_jid);

-- ============================================================================
-- 2) RPC de snapshot manual (chamada pelo group-dispatch-worker)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.snapshot_group_message_exposure(
  p_group_campaign_message_id uuid,
  p_group_campaign_id uuid,
  p_group_jid text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted int := 0;
  v_group_name text;
  v_has_members boolean;
BEGIN
  SELECT subject INTO v_group_name FROM public.whatsapp_groups WHERE group_jid = p_group_jid LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_group_members WHERE group_jid = p_group_jid
  ) INTO v_has_members;

  IF NOT v_has_members THEN
    INSERT INTO public.group_message_exposures (
      group_campaign_message_id, group_campaign_id, group_jid, group_name, source
    ) VALUES (
      p_group_campaign_message_id, p_group_campaign_id, p_group_jid, v_group_name, 'gap_no_snapshot'
    );
    RETURN 0;
  END IF;

  WITH members AS (
    SELECT DISTINCT
      m.phone_e164,
      right(regexp_replace(coalesce(m.phone_e164,''),'\D','','g'), 8) AS sfx8,
      m.member_jid
    FROM public.whatsapp_group_members m
    WHERE m.group_jid = p_group_jid
      AND m.phone_e164 IS NOT NULL
  ),
  matched AS (
    SELECT
      mem.phone_e164,
      mem.sfx8,
      mem.member_jid,
      cu.id AS uid
    FROM members mem
    LEFT JOIN public.customers_unified cu
      ON cu.phone_suffix8 = mem.sfx8
     AND cu.merged_into_id IS NULL
  ),
  ins AS (
    INSERT INTO public.group_message_exposures (
      group_campaign_message_id, group_campaign_id, group_jid, group_name,
      unified_id, phone_e164, phone_suffix8, member_jid, source
    )
    SELECT
      p_group_campaign_message_id, p_group_campaign_id, p_group_jid, v_group_name,
      m.uid, m.phone_e164, m.sfx8, m.member_jid,
      'group_members_snapshot'
    FROM matched m
    RETURNING id
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;

-- ============================================================================
-- 3) View: relatório shadow — o que TERIA sido barrado por fluxo
-- ============================================================================
CREATE OR REPLACE VIEW public.campaign_shadow_report_v AS
WITH per_queue AS (
  -- carrossel
  SELECT 'campanha_envios'::text AS queue, ce.shadow_mode, ce.provider_at_send AS provider,
         ce.template_category_at_send AS category, ce.unit_cost_at_send AS cost,
         ce.created_at AS at_ts, ce.phone_suffix8
  FROM public.campanha_envios ce
  UNION ALL
  SELECT 'live_campaign_dispatches', lcd.shadow_mode, lcd.provider_at_send,
         lcd.template_category_at_send, lcd.unit_cost_at_send, lcd.created_at, right(regexp_replace(lcd.phone,'\D','','g'),8)
  FROM public.live_campaign_dispatches lcd
  UNION ALL
  SELECT 'mass_dispatch_targets', mdt.shadow_mode, mdt.provider_at_send,
         mdt.template_category_at_send, mdt.unit_cost_at_send, mdt.created_at, mdt.phone_suffix8
  FROM public.mass_dispatch_targets mdt
  UNION ALL
  SELECT 'automation_dispatch_sent', ads.shadow_mode, ads.provider_at_send,
         ads.template_category_at_send, ads.unit_cost_at_send, ads.sent_at, right(regexp_replace(ads.phone,'\D','','g'),8)
  FROM public.automation_dispatch_sent ads
  UNION ALL
  SELECT 'dispatch_recipients', dr.shadow_mode, dr.provider_at_send,
         dr.template_category_at_send, dr.unit_cost_at_send, dr.created_at, right(regexp_replace(dr.phone,'\D','','g'),8)
  FROM public.dispatch_recipients dr
)
SELECT
  queue,
  provider,
  category,
  shadow_mode,
  count(*)::int AS total_inserted,
  count(*) FILTER (WHERE shadow_mode)::int AS in_shadow,
  count(*) FILTER (WHERE NOT shadow_mode)::int AS in_enforcement,
  COALESCE(sum(cost), 0)::numeric(14,4) AS cost_total_brl,
  min(at_ts) AS first_at,
  max(at_ts) AS last_at
FROM per_queue
GROUP BY queue, provider, category, shadow_mode;

GRANT SELECT ON public.campaign_shadow_report_v TO authenticated;

-- ============================================================================
-- 4) RPC de relatório por período
-- ============================================================================
CREATE OR REPLACE FUNCTION public.shadow_report_period(
  p_since timestamptz DEFAULT now() - interval '7 days',
  p_until timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH per_queue AS (
    SELECT 'campanha_envios'::text AS queue, ce.shadow_mode, ce.unit_cost_at_send AS cost, ce.created_at AS at_ts
    FROM public.campanha_envios ce WHERE ce.created_at BETWEEN p_since AND p_until
    UNION ALL
    SELECT 'live_campaign_dispatches', lcd.shadow_mode, lcd.unit_cost_at_send, lcd.created_at
    FROM public.live_campaign_dispatches lcd WHERE lcd.created_at BETWEEN p_since AND p_until
    UNION ALL
    SELECT 'mass_dispatch_targets', mdt.shadow_mode, mdt.unit_cost_at_send, mdt.created_at
    FROM public.mass_dispatch_targets mdt WHERE mdt.created_at BETWEEN p_since AND p_until
    UNION ALL
    SELECT 'automation_dispatch_sent', ads.shadow_mode, ads.unit_cost_at_send, ads.sent_at
    FROM public.automation_dispatch_sent ads WHERE ads.sent_at BETWEEN p_since AND p_until
    UNION ALL
    SELECT 'dispatch_recipients', dr.shadow_mode, dr.unit_cost_at_send, dr.created_at
    FROM public.dispatch_recipients dr WHERE dr.created_at BETWEEN p_since AND p_until
  )
  SELECT jsonb_build_object(
    'since', p_since, 'until', p_until,
    'by_queue', COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  ) INTO v_out
  FROM (
    SELECT
      queue,
      count(*)::int AS total,
      count(*) FILTER (WHERE shadow_mode)::int AS in_shadow,
      count(*) FILTER (WHERE NOT shadow_mode)::int AS in_enforcement,
      COALESCE(sum(cost), 0)::numeric(14,4) AS cost_brl
    FROM per_queue GROUP BY queue
    ORDER BY queue
  ) x;
  RETURN v_out;
END;
$$;
