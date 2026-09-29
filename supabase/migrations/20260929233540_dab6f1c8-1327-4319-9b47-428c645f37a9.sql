
CREATE TABLE public.meta_ads_campaign_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL, campaign_id text NOT NULL, campaign_name text, objective text,
  date date NOT NULL, spend numeric NOT NULL DEFAULT 0, impressions int DEFAULT 0, reach int DEFAULT 0,
  link_clicks int DEFAULT 0, synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, campaign_id, date)
);
GRANT SELECT ON public.meta_ads_campaign_spend_daily TO authenticated;
GRANT ALL ON public.meta_ads_campaign_spend_daily TO service_role;
ALTER TABLE public.meta_ads_campaign_spend_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read spend" ON public.meta_ads_campaign_spend_daily FOR SELECT TO authenticated USING (true);

CREATE TABLE public.meta_ads_campaign_group_overrides (
  campaign_id text PRIMARY KEY, campaign_name text, group_override text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ads_campaign_group_overrides TO authenticated;
GRANT ALL ON public.meta_ads_campaign_group_overrides TO service_role;
ALTER TABLE public.meta_ads_campaign_group_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage overrides" ON public.meta_ads_campaign_group_overrides FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.meta_ads_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL, rows_upserted int DEFAULT 0,
  since date, until date, error text
);
GRANT SELECT ON public.meta_ads_sync_runs TO authenticated;
GRANT ALL ON public.meta_ads_sync_runs TO service_role;
ALTER TABLE public.meta_ads_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sync runs" ON public.meta_ads_sync_runs FOR SELECT TO authenticated USING (true);

CREATE TABLE public.dispatch_unit_cost_rates (
  category text PRIMARY KEY, unit_cost_brl numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.dispatch_unit_cost_rates TO authenticated;
GRANT ALL ON public.dispatch_unit_cost_rates TO service_role;
ALTER TABLE public.dispatch_unit_cost_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rates" ON public.dispatch_unit_cost_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update rates" ON public.dispatch_unit_cost_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth insert rates" ON public.dispatch_unit_cost_rates FOR INSERT TO authenticated WITH CHECK (true);
INSERT INTO public.dispatch_unit_cost_rates(category, unit_cost_brl) VALUES
 ('MARKETING',0.39),('UTILITY',0.04),('AUTHENTICATION',0.04),('SERVICE',0);

CREATE OR REPLACE FUNCTION public.meta_ads_campaign_group(campaign_name text, campaign_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT o.group_override FROM public.meta_ads_campaign_group_overrides o WHERE o.campaign_id = $2),
    CASE
      WHEN upper(coalesce($1,'')) LIKE '%LIVE%' AND upper(coalesce($1,'')) LIKE '%VENDA%' THEN 'LIVE'
      WHEN upper(coalesce($1,'')) LIKE '%WHATS%' THEN 'WHATSAPP'
      WHEN upper(coalesce($1,'')) LIKE '%LEAD%' THEN 'LEADS'
      WHEN upper(coalesce($1,'')) LIKE '%ENG%' OR upper(coalesce($1,'')) LIKE '%ALCANCE%' THEN 'ENGAJAMENTO'
      ELSE 'OUTROS'
    END)
$$;

CREATE OR REPLACE VIEW public.v_dispatch_cost_daily WITH (security_invoker = on) AS
WITH r AS (SELECT category, unit_cost_brl FROM public.dispatch_unit_cost_rates),
u AS (
  SELECT (COALESCE(d.started_at, d.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS date,
         'dispatch_history'::text AS source, COALESCE(d.sent_count,0)::numeric AS messages,
         COALESCE(d.sent_count,0) * COALESCE(d.cost_override_brl, d.unit_cost_at_send, d.cost_per_message,
           (SELECT unit_cost_brl FROM r WHERE r.category = upper(COALESCE(d.template_category_at_send, d.template_category))), 0) AS cost_brl
  FROM public.dispatch_history d
  WHERE (COALESCE(d.provider_at_send, d.provider) IS NULL OR COALESCE(d.provider_at_send, d.provider) ILIKE '%meta%')
    AND COALESCE(d.shadow_mode,false) = false
  UNION ALL
  SELECT (COALESCE(x.sent_at, x.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, 'live_campaign_dispatches', 1,
         COALESCE(x.unit_cost_at_send, (SELECT unit_cost_brl FROM r WHERE r.category = upper(x.template_category_at_send)), (SELECT unit_cost_brl FROM r WHERE r.category='UTILITY'))
  FROM public.live_campaign_dispatches x
  WHERE x.status='sent' AND (x.provider_at_send IS NULL OR x.provider_at_send ILIKE '%meta%') AND COALESCE(x.shadow_mode,false)=false
  UNION ALL
  SELECT (COALESCE(x.sent_at, x.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, 'mass_dispatch_targets', 1,
         COALESCE(x.unit_cost_at_send, (SELECT unit_cost_brl FROM r WHERE r.category = upper(x.template_category_at_send)), (SELECT unit_cost_brl FROM r WHERE r.category='UTILITY'))
  FROM public.mass_dispatch_targets x
  WHERE x.status='sent' AND (x.provider_at_send IS NULL OR x.provider_at_send ILIKE '%meta%') AND COALESCE(x.shadow_mode,false)=false
  UNION ALL
  SELECT (x.sent_at AT TIME ZONE 'America/Sao_Paulo')::date, 'automation_dispatch_sent', 1,
         COALESCE(x.unit_cost_at_send, (SELECT unit_cost_brl FROM r WHERE r.category = upper(x.template_category_at_send)), (SELECT unit_cost_brl FROM r WHERE r.category='UTILITY'))
  FROM public.automation_dispatch_sent x
  WHERE x.status='sent' AND (x.provider_at_send IS NULL OR x.provider_at_send ILIKE '%meta%') AND COALESCE(x.shadow_mode,false)=false
)
SELECT date, source, sum(messages)::bigint AS messages, round(sum(cost_brl),2) AS cost_brl
FROM u WHERE date IS NOT NULL GROUP BY date, source;
GRANT SELECT ON public.v_dispatch_cost_daily TO authenticated;

CREATE OR REPLACE VIEW public.v_revenue_daily_by_channel WITH (security_invoker = on) AS
WITH s AS (
  SELECT (ps.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS date, COALESCE(ps.total,0) AS total,
    CASE
      WHEN ps.event_id IS NOT NULL OR ps.source_order_id IS NOT NULL OR ps.sales_channel ILIKE '%live%' THEN 'live'
      WHEN ps.sales_channel = 'whatsapp' THEN 'whatsapp'
      WHEN ps.sales_channel IN ('link_online','site') THEN 'online'
      WHEN ps.sales_channel = 'presencial' THEN 'loja'
      ELSE 'outros' END AS ch
  FROM public.pos_sales ps WHERE ps.status_cancelamento = 'ativo'
)
SELECT date,
  sum(total) FILTER (WHERE ch='live') AS rec_live, count(*) FILTER (WHERE ch='live') AS n_live,
  sum(total) FILTER (WHERE ch='whatsapp') AS rec_whatsapp, count(*) FILTER (WHERE ch='whatsapp') AS n_whatsapp,
  sum(total) FILTER (WHERE ch='online') AS rec_online, count(*) FILTER (WHERE ch='online') AS n_online,
  sum(total) FILTER (WHERE ch='loja') AS rec_loja, count(*) FILTER (WHERE ch='loja') AS n_loja,
  sum(total) AS rec_total, count(*) AS n_total
FROM s GROUP BY date;
GRANT SELECT ON public.v_revenue_daily_by_channel TO authenticated;

CREATE MATERIALIZED VIEW public.mv_ad_contact_first_touch AS
WITH t AS (
  SELECT right(regexp_replace(m.phone,'\D','','g'),8) AS phone_key, m.created_at AS touch_at,
         'whatsapp_ad'::text AS source, m.referral->>'headline' AS campaign_ref,
         left(split_part(COALESCE(m.referral->>'body',''), E'\n', 1), 60) AS product_ref
  FROM public.whatsapp_messages_unified m
  WHERE m.referral->>'source_type' = 'ad' AND m.direction = 'incoming'
  UNION ALL
  SELECT right(regexp_replace(l.phone,'\D','','g'),8), l.created_at, 'leads_ad', l.utm_campaign, l.utm_term
  FROM public.event_leads l WHERE l.utm_campaign IS NOT NULL AND l.phone IS NOT NULL
)
SELECT DISTINCT ON (phone_key) phone_key, touch_at AS first_touch_at, source, campaign_ref, product_ref
FROM t WHERE length(phone_key) = 8
ORDER BY phone_key, touch_at ASC;
CREATE UNIQUE INDEX mv_ad_contact_first_touch_pk ON public.mv_ad_contact_first_touch(phone_key);
REVOKE ALL ON public.mv_ad_contact_first_touch FROM anon;
GRANT SELECT ON public.mv_ad_contact_first_touch TO authenticated;
GRANT ALL ON public.mv_ad_contact_first_touch TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_ad_first_touch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ad_contact_first_touch;
END $$;
REVOKE EXECUTE ON FUNCTION public.refresh_ad_first_touch() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.refresh_ad_first_touch() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_ad_attributed_sales WITH (security_invoker = on) AS
WITH ft AS (
  SELECT f.*, date_trunc('week', f.first_touch_at AT TIME ZONE 'America/Sao_Paulo')::date AS week_start
  FROM public.mv_ad_contact_first_touch f
),
sales AS (
  SELECT ft.phone_key, ft.week_start, ft.source, ps.total,
    (ps.event_id IS NOT NULL OR ps.source_order_id IS NOT NULL OR ps.sales_channel ILIKE '%live%') AS is_live
  FROM ft JOIN public.pos_sales ps
    ON COALESCE(ps.phone_suffix8, right(regexp_replace(ps.customer_phone,'\D','','g'),8)) = ft.phone_key
   AND ps.created_at >= ft.first_touch_at AND ps.created_at < ft.first_touch_at + interval '14 days'
  WHERE ps.status_cancelamento = 'ativo'
),
agg AS (
  SELECT week_start, source,
    count(DISTINCT phone_key) FILTER (WHERE is_live) AS buyers_live,
    COALESCE(sum(total) FILTER (WHERE is_live),0) AS revenue_live,
    count(DISTINCT phone_key) FILTER (WHERE NOT is_live) AS buyers_fora_live,
    COALESCE(sum(total) FILTER (WHERE NOT is_live),0) AS revenue_fora_live
  FROM sales GROUP BY 1,2
),
c AS (SELECT week_start, source, count(*) AS contacts FROM ft GROUP BY 1,2)
SELECT c.week_start, c.source,
  COALESCE(a.buyers_live,0) AS buyers_live, COALESCE(a.revenue_live,0) AS revenue_live,
  COALESCE(a.buyers_fora_live,0) AS buyers_fora_live, COALESCE(a.revenue_fora_live,0) AS revenue_fora_live,
  c.contacts
FROM c LEFT JOIN agg a USING (week_start, source);
GRANT SELECT ON public.v_ad_attributed_sales TO authenticated;

CREATE OR REPLACE FUNCTION public.event_buyer_origin_matrix_v2(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_start timestamptz; v_list jsonb;
BEGIN
  v := public.event_buyer_origin_matrix(p_event_id);
  IF v ? 'error' THEN RETURN v; END IF;
  SELECT COALESCE(start_date::timestamptz, created_at) INTO v_start FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(jsonb_agg(b || jsonb_build_object('ad_origin', f.source)), '[]'::jsonb) INTO v_list
  FROM jsonb_array_elements(COALESCE(v->'buyer_list','[]'::jsonb)) b
  LEFT JOIN public.mv_ad_contact_first_touch f
    ON f.phone_key = right(b->>'phone_key', 8) AND f.first_touch_at < v_start;
  RETURN v
    || jsonb_build_object('buyer_list', v_list)
    || jsonb_build_object('buyers', COALESCE(v->'buyers','{}'::jsonb) || jsonb_build_object(
         'from_whatsapp_ad', (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'ad_origin'='whatsapp_ad'),
         'from_leads_ad', (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'ad_origin'='leads_ad')));
END $$;
REVOKE EXECUTE ON FUNCTION public.event_buyer_origin_matrix_v2(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.event_buyer_origin_matrix_v2(uuid) TO authenticated;
