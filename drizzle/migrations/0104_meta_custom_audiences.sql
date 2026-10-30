CREATE TABLE public.meta_audience_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  audience_id text UNIQUE,
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'erp',
  enabled boolean NOT NULL DEFAULT true,
  frozen boolean NOT NULL DEFAULT false,
  initial_mode text NOT NULL DEFAULT 'add',
  initial_load_done boolean NOT NULL DEFAULT false,
  initial_load_not_before timestamptz,
  last_sync_at timestamptz,
  last_status text,
  last_error text,
  erp_count integer,
  invalid_count integer,
  duplicate_count integer,
  added_last integer,
  removed_last integer,
  total_sent integer NOT NULL DEFAULT 0,
  total_removed integer NOT NULL DEFAULT 0,
  meta_approx_lower integer,
  meta_approx_upper integer,
  meta_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.meta_audience_candidates (
  definition_id uuid NOT NULL REFERENCES public.meta_audience_definitions(id) ON DELETE CASCADE,
  key text NOT NULL,
  phone text, email text, full_name text, city text, state text, zip text,
  PRIMARY KEY (definition_id, key)
);
CREATE TABLE public.meta_audience_members (
  definition_id uuid NOT NULL REFERENCES public.meta_audience_definitions(id) ON DELETE CASCADE,
  key text NOT NULL,
  row_hash text NOT NULL,
  hashes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',
  since timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_id, key)
);
CREATE TABLE public.meta_audience_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid REFERENCES public.meta_audience_definitions(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  mode text,
  erp_count integer, added integer, removed integer,
  error text,
  details jsonb
);
CREATE INDEX meta_audience_sync_runs_def_idx ON public.meta_audience_sync_runs(definition_id, started_at DESC);

GRANT SELECT ON public.meta_audience_definitions, public.meta_audience_sync_runs TO authenticated;
GRANT ALL ON public.meta_audience_definitions, public.meta_audience_candidates, public.meta_audience_members, public.meta_audience_sync_runs TO service_role;
ALTER TABLE public.meta_audience_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_audience_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_audience_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_audience_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audience defs" ON public.meta_audience_definitions FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins read audience runs" ON public.meta_audience_sync_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- DDD+8 key from any BR phone, or NULL
CREATE OR REPLACE FUNCTION public.meta_aud_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (SELECT regexp_replace(regexp_replace(coalesce(p,''),'\D','','g'),'^0+','') x),
  s AS (SELECT CASE WHEN length(x) IN (12,13) AND x LIKE '55%' THEN substr(x,3) ELSE x END y FROM d),
  n AS (SELECT substr(y,1,2) ddd, substr(y,3) num FROM s WHERE length(y) IN (10,11))
  SELECT '55'||ddd||CASE WHEN length(num)=8 AND num ~ '^[6-9]' THEN '9'||num ELSE num END
  FROM n WHERE ddd ~ '^[1-9][0-9]$' AND (length(num)=9 AND num ~ '^9' OR length(num)=8 AND num ~ '^[2-5]' OR length(num)=8 AND num ~ '^[6-9]')
$$;
CREATE OR REPLACE FUNCTION public.meta_aud_email(e text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(trim(e)) ~ '^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$'
    AND lower(trim(e)) !~ '@cliente\.bananacalcados\.com\.br$' THEN lower(trim(e)) END
$$;

CREATE OR REPLACE FUNCTION public.meta_audience_refresh_candidates(p_definition_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '120s' AS $$
DECLARE v_rule text; v_frozen boolean; v_total int; v_invalid int; v_count int; v_last_event uuid;
BEGIN
  SELECT rule_key, frozen INTO v_rule, v_frozen FROM meta_audience_definitions WHERE id = p_definition_id;
  IF v_rule IS NULL OR v_frozen THEN RAISE EXCEPTION 'definition not syncable'; END IF;

  CREATE TEMP TABLE _src(phone text, email text, full_name text, city text, state text, zip text) ON COMMIT DROP;

  CREATE TEMP TABLE _op ON COMMIT DROP AS
    SELECT o.id, o.event_id, o.is_paid, o.paid_at, o.created_at, o.stage,
      coalesce(nullif(c.whatsapp,''), cu.phone_e164, a.confirmed_phone, a.entered_phone) phone,
      cu.email, coalesce(cu.name, c.full_name) full_name, cu.city, cu.state, cu.cep
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN customers_unified cu ON cu.id = o.customer_unified_id
    LEFT JOIN LATERAL (SELECT confirmed_phone, entered_phone FROM live_selfservice_accesses a WHERE o.id = ANY(a.order_ids) ORDER BY a.updated_at DESC LIMIT 1) a ON true
    WHERE o.merged_into_order_id IS NULL;

  CREATE TEMP TABLE _ps ON COMMIT DROP AS
    SELECT sale_type, created_at, customer_phone phone, customer_email email, customer_name full_name, customer_city city, customer_state state, customer_cep zip
    FROM pos_sales WHERE status IN ('paid','completed');

  IF v_rule IN ('live_90d') THEN
    INSERT INTO _src SELECT phone,email,full_name,city,state,cep FROM _op WHERE is_paid AND event_id IS NOT NULL AND paid_at > now() - interval '90 days';
  ELSIF v_rule = 'online_mar2026' THEN
    INSERT INTO _src SELECT phone,email,full_name,city,state,cep FROM _op WHERE is_paid AND paid_at >= '2026-03-01';
    INSERT INTO _src SELECT phone,email,full_name,city,state,zip FROM _ps WHERE sale_type IN ('online','live') AND created_at >= '2026-03-01';
  ELSIF v_rule = 'fisica_mar2026' THEN
    INSERT INTO _src SELECT phone,email,full_name,city,state,zip FROM _ps WHERE sale_type = 'physical' AND created_at >= '2026-03-01';
  ELSIF v_rule = 'fisica_180d' THEN
    INSERT INTO _src SELECT phone,email,full_name,city,state,zip FROM _ps WHERE sale_type = 'physical' AND created_at > now() - interval '180 days';
  ELSIF v_rule = 'todos_base' THEN
    INSERT INTO _src SELECT phone_e164, email, name, city, state, cep FROM customers_unified
      WHERE merged_into_id IS NULL AND NOT coalesce(is_archived,false) AND (coalesce(total_orders,0) > 0 OR coalesce(legacy_orders,0) > 0);
  ELSIF v_rule = 'compraram_7d' THEN
    INSERT INTO _src SELECT phone,email,full_name,city,state,cep FROM _op WHERE is_paid AND paid_at > now() - interval '7 days';
    INSERT INTO _src SELECT phone,email,full_name,city,state,zip FROM _ps WHERE created_at > now() - interval '7 days';
  ELSIF v_rule = 'incompletos_ultima_live' THEN
    SELECT event_id INTO v_last_event FROM orders WHERE event_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
    INSERT INTO _src SELECT phone,email,full_name,city,state,cep FROM _op WHERE event_id = v_last_event AND stage = 'incomplete_order';
  ELSIF v_rule = 'nao_pagaram_14d' THEN
    INSERT INTO _src SELECT phone,email,full_name,city,state,cep FROM _op WHERE NOT is_paid AND coalesce(stage,'') <> 'cancelled' AND created_at > now() - interval '14 days';
  ELSIF v_rule = 'sem_compra_60_180d' THEN
    INSERT INTO _src SELECT phone_e164, email, name, city, state, cep FROM customers_unified
      WHERE merged_into_id IS NULL AND NOT coalesce(is_archived,false) AND coalesce(total_orders,0) > 0
        AND last_purchase_at < now() - interval '60 days' AND last_purchase_at > now() - interval '180 days';
  ELSIF v_rule = 'vip_membros' THEN
    INSERT INTO _src SELECT DISTINCT m.phone, NULL, m.display_name, NULL, NULL, NULL FROM whatsapp_group_members m
      WHERE m.status = 'member' AND NOT coalesce(m.is_internal,false)
        AND m.group_jid_base IN (SELECT group_jid_base FROM whatsapp_groups WHERE is_vip);
  ELSIF v_rule = 'leads_nunca_compraram' THEN
    INSERT INTO _src SELECT phone, NULL, name, NULL, NULL, NULL FROM event_leads WHERE NOT coalesce(disqualified,false);
    INSERT INTO _src SELECT phone, email, name, NULL, NULL, NULL FROM lp_leads;
    INSERT INTO _src SELECT whatsapp, NULL, NULL, NULL, NULL, NULL FROM catalog_lead_registrations;
    INSERT INTO _src SELECT m.phone, NULL, m.display_name, NULL, NULL, NULL FROM whatsapp_group_members m WHERE NOT coalesce(m.is_internal,false);
  ELSE
    RAISE EXCEPTION 'unknown rule %', v_rule;
  END IF;

  SELECT count(*) INTO v_total FROM _src;
  SELECT count(*) INTO v_invalid FROM _src WHERE meta_aud_phone(phone) IS NULL AND meta_aud_email(email) IS NULL;

  CREATE TEMP TABLE _k ON COMMIT DROP AS
    SELECT DISTINCT ON (key) key, ph, em, full_name, city, state, zip FROM (
      SELECT coalesce('p'||substr(meta_aud_phone(phone),3,2)||right(meta_aud_phone(phone),8), 'e'||meta_aud_email(email)) key,
        meta_aud_phone(phone) ph, meta_aud_email(email) em, nullif(trim(full_name),'') full_name, nullif(trim(city),'') city, nullif(trim(state),'') state, nullif(trim(zip),'') zip
      FROM _src
    ) s WHERE key IS NOT NULL
    ORDER BY key, (em IS NOT NULL) DESC, (city IS NOT NULL) DESC;

  -- enrich phone-only rows with the unified customer record (DDD + 8 digits)
  UPDATE _k SET em = coalesce(_k.em, meta_aud_email(cu.email)), full_name = coalesce(_k.full_name, cu.name),
    city = coalesce(_k.city, cu.city), state = coalesce(_k.state, cu.state), zip = coalesce(_k.zip, cu.cep)
  FROM customers_unified cu
  WHERE _k.key LIKE 'p%' AND cu.merged_into_id IS NULL AND cu.phone_suffix8 = right(_k.key,8) AND cu.ddd = substr(_k.key,2,2)
    AND (_k.em IS NULL OR _k.city IS NULL);

  IF v_rule = 'leads_nunca_compraram' OR v_rule = 'nao_pagaram_14d' THEN
    DELETE FROM _k WHERE key IN (
      SELECT 'p'||substr(meta_aud_phone(x),3,2)||right(meta_aud_phone(x),8) FROM (
        SELECT phone_e164 x FROM customers_unified WHERE merged_into_id IS NULL AND (coalesce(total_orders,0)>0 OR coalesce(legacy_orders,0)>0)
          AND (v_rule = 'leads_nunca_compraram' OR last_purchase_at > now() - interval '14 days')
        UNION ALL SELECT phone FROM _op WHERE is_paid AND (v_rule = 'leads_nunca_compraram' OR paid_at > now() - interval '14 days')
        UNION ALL SELECT phone FROM _ps WHERE v_rule = 'leads_nunca_compraram' OR created_at > now() - interval '14 days'
      ) b WHERE meta_aud_phone(x) IS NOT NULL);
  END IF;

  -- advertising refusals (same rule as CAPI): never in any audience
  DELETE FROM _k WHERE key IN (
    SELECT 'p'||coalesce(a.confirmed_phone_key, a.phone_key) FROM live_selfservice_accesses a
    JOIN selfservice_advertising_consents c ON c.id = a.advertising_consent_id WHERE c.advertising = false
      AND coalesce(a.confirmed_phone_key, a.phone_key) IS NOT NULL);

  DELETE FROM meta_audience_candidates WHERE definition_id = p_definition_id;
  INSERT INTO meta_audience_candidates(definition_id, key, phone, email, full_name, city, state, zip)
    SELECT p_definition_id, key, ph, em, full_name, city, state, zip FROM _k;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE meta_audience_definitions SET erp_count = v_count, invalid_count = v_invalid,
    duplicate_count = greatest(v_total - v_invalid - v_count, 0), updated_at = now() WHERE id = p_definition_id;
  RETURN jsonb_build_object('count', v_count, 'invalid', v_invalid, 'total', v_total);
END $$;
REVOKE ALL ON FUNCTION public.meta_audience_refresh_candidates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_audience_refresh_candidates(uuid) TO service_role;

INSERT INTO public.meta_audience_definitions(rule_key, audience_id, name, description, kind, enabled, frozen, initial_mode, initial_load_not_before) VALUES
 ('live_90d','120253057528280067','compradores_live_90d','Pedido pago de live nos últimos 90 dias','existing',true,false,'replace','2026-11-03 06:00:00+00'),
 ('online_mar2026','120252916762330067','compradores-online-desde-mar2026','Pedidos pagos de live/WhatsApp/site desde 01/03/2026','existing',true,false,'replace','2026-11-03 06:00:00+00'),
 ('fisica_mar2026','120252916773680067','compradores-loja-fisica-desde-mar2026','Vendas presenciais desde 01/03/2026','existing',true,false,'replace','2026-11-03 06:00:00+00'),
 ('fisica_180d','120251731237170067','compradores_loja_180d','Vendas presenciais nos últimos 180 dias','existing',true,false,'replace','2026-11-03 06:00:00+00'),
 ('leads_nunca_compraram','120252916754200067','leads-que-nunca-compraram','Leads de evento, captação, catálogo e grupos sem nenhuma compra','existing',true,false,'replace','2026-11-03 06:00:00+00'),
 ('todos_base','120252916798400067','todos-os-clientes-base','Base unificada de clientes com compra (inclui importados)','existing',true,false,'replace','2026-11-03 06:00:00+00'),
 ('frozen_mar_set','120252933483590067','Clientes Março a 19 Setembro','Congelado: base de semelhante, nunca sincronizar','frozen',false,true,'add',NULL),
 ('frozen_audiencia_csv','120247263513300067','audiencia_meta_banana.csv','Congelado: base de semelhantes, nunca sincronizar','frozen',false,true,'add',NULL),
 ('compraram_7d',NULL,'ERP – Compraram últimos 7 dias','Qualquer compra paga nos últimos 7 dias (exclusão)','erp',true,false,'add',NULL),
 ('incompletos_ultima_live',NULL,'ERP – Incompletos última live','Pedidos incompletos do evento mais recente com pedido','erp',true,false,'add',NULL),
 ('nao_pagaram_14d',NULL,'ERP – Pediram e não pagaram 14d','Pedido nos últimos 14 dias sem pagamento e sem compra no período','erp',true,false,'add',NULL),
 ('sem_compra_60_180d',NULL,'ERP – Clientes sem compra 60–180d','Última compra entre 60 e 180 dias','erp',true,false,'add',NULL),
 ('vip_membros',NULL,'ERP – Grupos VIP membros','Membros ativos de grupos VIP','erp',true,false,'add',NULL);