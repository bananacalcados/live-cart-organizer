CREATE OR REPLACE FUNCTION public.meta_audience_refresh_candidates(p_definition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
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
    LEFT JOIN LATERAL (SELECT confirmed_phone, entered_phone FROM live_selfservice_accesses a WHERE a.order_ids @> ARRAY[o.id] ORDER BY a.updated_at DESC LIMIT 1) a ON true
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

  -- normaliza cada linha uma única vez (meta_aud_phone é cara)
  CREATE TEMP TABLE _n ON COMMIT DROP AS
    SELECT meta_aud_phone(phone) ph, meta_aud_email(email) em, full_name, city, state, zip FROM _src;
  SELECT count(*) INTO v_total FROM _n;
  SELECT count(*) INTO v_invalid FROM _n WHERE ph IS NULL AND em IS NULL;

  CREATE TEMP TABLE _k ON COMMIT DROP AS
    SELECT DISTINCT ON (key) key, ph, em, full_name, city, state, zip FROM (
      SELECT coalesce('p'||substr(ph,3,2)||right(ph,8), 'e'||em) key,
        ph, em, nullif(trim(full_name),'') full_name, nullif(trim(city),'') city, nullif(trim(state),'') state, nullif(trim(zip),'') zip
      FROM _n
    ) s WHERE key IS NOT NULL
    ORDER BY key, (em IS NOT NULL) DESC, (city IS NOT NULL) DESC;
  CREATE INDEX ON _k(key);
  ANALYZE _k;

  UPDATE _k SET em = coalesce(_k.em, meta_aud_email(cu.email)), full_name = coalesce(_k.full_name, cu.name),
    city = coalesce(_k.city, cu.city), state = coalesce(_k.state, cu.state), zip = coalesce(_k.zip, cu.cep)
  FROM customers_unified cu
  WHERE _k.key LIKE 'p%' AND cu.merged_into_id IS NULL AND cu.phone_suffix8 = right(_k.key,8) AND cu.ddd = substr(_k.key,2,2)
    AND (_k.em IS NULL OR _k.city IS NULL);

  IF v_rule = 'leads_nunca_compraram' OR v_rule = 'nao_pagaram_14d' THEN
    CREATE TEMP TABLE _buy ON COMMIT DROP AS
      SELECT DISTINCT 'p'||substr(y,3,2)||right(y,8) key FROM (SELECT meta_aud_phone(x) y FROM (
        SELECT phone_e164 x FROM customers_unified WHERE merged_into_id IS NULL AND (coalesce(total_orders,0)>0 OR coalesce(legacy_orders,0)>0)
          AND (v_rule = 'leads_nunca_compraram' OR last_purchase_at > now() - interval '14 days')
        UNION ALL SELECT phone FROM _op WHERE is_paid AND (v_rule = 'leads_nunca_compraram' OR paid_at > now() - interval '14 days')
        UNION ALL SELECT phone FROM _ps WHERE v_rule = 'leads_nunca_compraram' OR created_at > now() - interval '14 days'
      ) b) bb WHERE y IS NOT NULL;
    ANALYZE _buy;
    DELETE FROM _k USING _buy WHERE _k.key = _buy.key;
  END IF;

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
END $function$;