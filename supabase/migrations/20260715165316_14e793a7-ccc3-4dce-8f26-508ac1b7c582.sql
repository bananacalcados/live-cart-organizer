-- Amplia constraint de rule para aceitar 'email_deferred'
ALTER TABLE public.unified_merge_log DROP CONSTRAINT IF EXISTS unified_merge_log_rule_check;
ALTER TABLE public.unified_merge_log
  ADD CONSTRAINT unified_merge_log_rule_check
  CHECK (rule IN ('cpf','phone_suffix8','email','email_deferred','cpf_deferred','phone_deferred'));

-- 1) Log dos 56 grupos de email como "adiado"
DO $mig$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_sim   jsonb := simulate_merge_unified_duplicates();
  v_grp   jsonb;
  v_row   jsonb;
  v_survivor uuid;
BEGIN
  FOR v_grp IN SELECT * FROM jsonb_array_elements(v_sim -> 'email_rule' -> 'sample')
  LOOP
    v_survivor := (v_grp ->> 'survivor_id')::uuid;
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_grp -> 'rows')
    LOOP
      IF (v_row ->> 'id')::uuid <> v_survivor THEN
        INSERT INTO public.unified_merge_log
          (merge_batch_id, rule, survivor_id, absorbed_id, absorbed_row, fks_repointed, mirror_sales_detected, merged_at, reverted_at)
        VALUES
          (v_batch, 'email_deferred', v_survivor, (v_row ->> 'id')::uuid,
           v_row, '{}'::jsonb, COALESCE((v_grp ->> 'mirror_sales_detected')::int, 0),
           now(), now());
      END IF;
    END LOOP;
  END LOOP;
END $mig$;

-- 2) MERGE R2 (phone_suffix8) — grupo Suzan
DO $mig$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_absorbed uuid := 'e8ad3b1c-f5f7-479a-a8b3-82604cb8004a';
  v_survivor uuid := 'e71188d1-5018-4cbe-b78c-ac3c8b35c119';
  v_absorbed_row jsonb;
  v_repointed jsonb := '{}'::jsonb;
  v_n int;
BEGIN
  SELECT to_jsonb(cu.*) INTO v_absorbed_row FROM customers_unified cu WHERE id = v_absorbed AND merged_into_id IS NULL;
  IF v_absorbed_row IS NULL THEN
    RAISE NOTICE 'Grupo Suzan já mesclado ou ausente — nada a fazer.';
    RETURN;
  END IF;

  UPDATE pos_sales SET customer_unified_id = v_survivor WHERE customer_unified_id = v_absorbed;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_repointed := v_repointed || jsonb_build_object('pos_sales', v_n);

  UPDATE orders SET customer_unified_id = v_survivor WHERE customer_unified_id = v_absorbed;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_repointed := v_repointed || jsonb_build_object('orders', v_n);

  DELETE FROM customer_list_memberships m
   WHERE m.customer_id = v_absorbed
     AND EXISTS (SELECT 1 FROM customer_list_memberships m2
                  WHERE m2.customer_id = v_survivor AND m2.list_id = m.list_id);
  UPDATE customer_list_memberships SET customer_id = v_survivor WHERE customer_id = v_absorbed;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_repointed := v_repointed || jsonb_build_object('list_memberships_repointed', v_n);

  UPDATE customers_unified s SET
    cpf              = COALESCE(s.cpf, a.cpf),
    email            = COALESCE(s.email, a.email),
    phone_e164       = COALESCE(s.phone_e164, a.phone_e164),
    phone_suffix8    = COALESCE(s.phone_suffix8, a.phone_suffix8),
    instagram_handle = COALESCE(s.instagram_handle, a.instagram_handle),
    address          = COALESCE(s.address, a.address),
    address_number   = COALESCE(s.address_number, a.address_number),
    complement       = COALESCE(s.complement, a.complement),
    neighborhood     = COALESCE(s.neighborhood, a.neighborhood),
    city             = COALESCE(s.city, a.city),
    state            = COALESCE(s.state, a.state),
    cep              = COALESCE(s.cep, a.cep),
    birth_date       = COALESCE(s.birth_date, a.birth_date),
    gender           = COALESCE(s.gender, a.gender),
    shoe_size        = COALESCE(s.shoe_size, a.shoe_size),
    preferred_style  = COALESCE(s.preferred_style, a.preferred_style),
    age_range        = COALESCE(s.age_range, a.age_range),
    tags             = ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(s.tags, ARRAY[]::text[]) || COALESCE(a.tags, ARRAY[]::text[])) x WHERE x IS NOT NULL),
    total_orders     = COALESCE(s.total_orders,0) + COALESCE(a.total_orders,0),
    total_spent      = COALESCE(s.total_spent,0)  + COALESCE(a.total_spent,0),
    total_items      = COALESCE(s.total_items,0)  + COALESCE(a.total_items,0),
    cashback_balance = COALESCE(s.cashback_balance,0) + COALESCE(a.cashback_balance,0),
    loyalty_points   = COALESCE(s.loyalty_points,0) + COALESCE(a.loyalty_points,0),
    loyalty_lifetime_points = COALESCE(s.loyalty_lifetime_points,0) + COALESCE(a.loyalty_lifetime_points,0),
    first_purchase_at = LEAST(s.first_purchase_at, a.first_purchase_at),
    last_purchase_at  = GREATEST(s.last_purchase_at, a.last_purchase_at),
    last_seen_at      = GREATEST(s.last_seen_at, a.last_seen_at),
    previous_phones   = ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(s.previous_phones, ARRAY[]::text[]) || COALESCE(a.previous_phones, ARRAY[]::text[]) || CASE WHEN a.phone_e164 IS NOT NULL AND a.phone_e164 <> COALESCE(s.phone_e164,'') THEN ARRAY[a.phone_e164] ELSE ARRAY[]::text[] END) x WHERE x IS NOT NULL),
    updated_at        = now()
  FROM customers_unified a
  WHERE s.id = v_survivor AND a.id = v_absorbed;

  UPDATE customers_unified SET merged_into_id = v_survivor, updated_at = now() WHERE id = v_absorbed;

  INSERT INTO unified_merge_log
    (merge_batch_id, rule, survivor_id, absorbed_id, absorbed_row, fks_repointed, mirror_sales_detected, merged_at)
  VALUES
    (v_batch, 'phone_suffix8', v_survivor, v_absorbed, v_absorbed_row, v_repointed, 0, now());
END $mig$;

-- 3) crm_customers_v filtra linhas ativas
CREATE OR REPLACE VIEW public.crm_customers_v AS
SELECT id,
       customer_code AS zoppy_id,
       NULLIF(split_part(COALESCE(name, ''::text), ' '::text, 1), ''::text) AS first_name,
       NULLIF(btrim(SUBSTRING(COALESCE(name, ''::text) FROM POSITION((' '::text) IN COALESCE(name, ''::text)) + 1)), ''::text) AS last_name,
       name, phone_e164 AS phone, phone_e164, phone_suffix8, email, cpf, city, state,
       COALESCE(NULLIF(btrim(region_type), ''::text), 'online'::text) AS region_type,
       ddd,
       rfm_r AS rfm_recency_score, rfm_f AS rfm_frequency_score, rfm_m AS rfm_monetary_score, rfm_total AS rfm_total_score,
       rfm_segment, total_orders, total_spent, avg_ticket, last_purchase_at, first_purchase_at,
       tags, opt_out_mass_dispatch, is_archived, created_at, updated_at, gender,
       purchased_brands, purchased_categories, purchased_sizes, purchased_stores, payment_methods,
       lead_temperature
FROM customers_unified cu
WHERE is_archived = false
  AND merged_into_id IS NULL;

-- 4) recalculate_lead_temperature() com 5 estados + filtro ativo
CREATE OR REPLACE FUNCTION public.recalculate_lead_temperature()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer := 0;
  v_started timestamptz := clock_timestamp();
  v_counts jsonb;
  v_counts_disp jsonb;
  v_silence_threshold integer;
BEGIN
  SELECT COALESCE(silencio_threshold_ignorados, 4) INTO v_silence_threshold
  FROM public.dispatch_touch_limits WHERE classificacao = 'silencio';
  IF v_silence_threshold IS NULL THEN v_silence_threshold := 4; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _lead_sig (
    suffix8 text PRIMARY KEY,
    last_reply_at timestamptz,
    last_read_at timestamptz,
    dispatch_total integer,
    dispatch_reacted integer,
    funnel_last_at timestamptz,
    consecutive_ignored integer
  ) ON COMMIT DROP;
  TRUNCATE _lead_sig;

  INSERT INTO _lead_sig (suffix8, last_reply_at)
  SELECT right(regexp_replace(phone,'\D','','g'),8), max(created_at)
  FROM whatsapp_messages
  WHERE direction='incoming' AND created_at > now() - interval '180 days' AND phone IS NOT NULL
  GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET last_reply_at = EXCLUDED.last_reply_at;

  INSERT INTO _lead_sig (suffix8, last_read_at, dispatch_total, dispatch_reacted)
  SELECT right(regexp_replace(phone,'\D','','g'),8),
    max(sent_at) FILTER (WHERE status='read'),
    count(*) FILTER (WHERE status IN ('sent','delivered','read','failed')),
    count(*) FILTER (WHERE status='read')
  FROM dispatch_recipients
  WHERE phone IS NOT NULL AND COALESCE(sent_at, created_at) > now() - interval '365 days'
  GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET
    last_read_at=EXCLUDED.last_read_at,
    dispatch_total=EXCLUDED.dispatch_total,
    dispatch_reacted=EXCLUDED.dispatch_reacted;

  INSERT INTO _lead_sig (suffix8, funnel_last_at)
  SELECT suffix8, max(created_at) FROM (
    SELECT right(regexp_replace(phone,'\D','','g'),8) suffix8, created_at FROM lp_leads    WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
    UNION ALL
    SELECT right(regexp_replace(phone,'\D','','g'),8), created_at         FROM event_leads WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
    UNION ALL
    SELECT right(regexp_replace(phone,'\D','','g'),8), created_at         FROM ad_leads    WHERE phone IS NOT NULL AND created_at > now() - interval '90 days'
  ) f GROUP BY 1
  ON CONFLICT (suffix8) DO UPDATE SET funnel_last_at=EXCLUDED.funnel_last_at;

  WITH anchors AS (
    SELECT cu.phone_suffix8 AS suffix8,
      GREATEST(
        COALESCE(s.last_reply_at,'epoch'::timestamptz),
        COALESCE(s.last_read_at,'epoch'::timestamptz),
        COALESCE(cu.last_purchase_at,'epoch'::timestamptz)
      ) AS anchor_at
    FROM customers_unified cu
    LEFT JOIN _lead_sig s ON s.suffix8=cu.phone_suffix8
    WHERE cu.phone_suffix8 IS NOT NULL AND cu.merged_into_id IS NULL
  ),
  streak AS (
    SELECT right(regexp_replace(dr.phone,'\D','','g'),8) AS suffix8, count(*) AS ignored_after
    FROM dispatch_recipients dr
    JOIN anchors a ON a.suffix8=right(regexp_replace(dr.phone,'\D','','g'),8)
    WHERE dr.phone IS NOT NULL AND dr.status IN ('sent','delivered')
      AND COALESCE(dr.sent_at,dr.created_at) > a.anchor_at
      AND COALESCE(dr.sent_at,dr.created_at) > now() - interval '365 days'
    GROUP BY 1
  )
  UPDATE _lead_sig ls SET consecutive_ignored=st.ignored_after
  FROM streak st WHERE ls.suffix8=st.suffix8;

  WITH calc AS (
    SELECT cu.id, cu.tags AS old_tags, cu.total_orders, cu.last_purchase_at,
      s.last_reply_at, s.last_read_at,
      COALESCE(s.dispatch_total,0)   AS d_total,
      COALESCE(s.dispatch_reacted,0) AS d_reacted,
      COALESCE(s.consecutive_ignored,0) AS d_ign_streak,
      s.funnel_last_at,
      GREATEST(s.last_reply_at, s.last_read_at) AS last_eng_at,
      CASE
        WHEN s.last_reply_at IS NOT NULL AND (s.last_read_at IS NULL OR s.last_reply_at >= s.last_read_at) THEN 'replied'
        WHEN s.last_read_at  IS NOT NULL THEN 'read'
        WHEN COALESCE(s.dispatch_total,0) > 0 THEN 'delivered'
        ELSE 'none'
      END AS last_eng_type
    FROM customers_unified cu
    LEFT JOIN _lead_sig s ON s.suffix8=cu.phone_suffix8
    WHERE cu.phone_suffix8 IS NOT NULL AND cu.merged_into_id IS NULL
  ),
  scored AS (
    SELECT c.*, GREATEST(0, d_total - d_reacted) AS d_ignored,
      CASE
        WHEN last_reply_at >= now() - interval '15 days' OR funnel_last_at >= now() - interval '7 days' THEN 'muito_quente'
        WHEN last_reply_at >= now() - interval '45 days' OR last_read_at >= now() - interval '30 days' OR funnel_last_at >= now() - interval '30 days' THEN 'quente'
        WHEN last_read_at  >= now() - interval '90 days' OR last_reply_at >= now() - interval '90 days' THEN 'morno'
        WHEN d_total >= 3 AND d_reacted = 0 THEN 'inerte'
        WHEN d_total > 0 THEN 'frio'
        ELSE 'frio'
      END AS temp,
      CASE
        WHEN last_purchase_at >= now() - interval '90 days'
             OR last_reply_at >= now() - interval '30 days'
          THEN 'quente'
        WHEN (last_purchase_at >= now() - interval '180 days' AND last_purchase_at < now() - interval '90 days')
             OR (COALESCE(total_orders,0) = 0 AND funnel_last_at >= now() - interval '60 days')
             OR (last_read_at >= now() - interval '30 days'
                 AND (last_purchase_at IS NULL OR last_purchase_at < now() - interval '90 days'))
          THEN 'morno'
        WHEN d_ign_streak >= v_silence_threshold
             AND (last_purchase_at IS NULL OR last_purchase_at < now() - interval '180 days')
             AND (last_reply_at    IS NULL OR last_reply_at    < now() - interval '90 days')
          THEN CASE
                 WHEN COALESCE(total_orders,0) > 0 OR last_purchase_at IS NOT NULL
                   THEN 'silencio_reativavel'
                 ELSE 'silencio_puro'
               END
        ELSE 'frio'
      END AS disp
    FROM calc c
  ),
  tagged AS (
    SELECT id, last_eng_at, last_eng_type, d_total, d_reacted, d_ignored, d_ign_streak, temp, disp,
      (
        COALESCE(ARRAY(
          SELECT t FROM unnest(COALESCE(old_tags, ARRAY[]::text[])) t
          WHERE t NOT LIKE 'engaja:%' AND t NOT LIKE 'lead:%' AND t NOT LIKE 'cliente:%'
            AND t NOT LIKE 'convertido:%' AND t <> 'bloqueou'
        ), ARRAY[]::text[])
        ||
        ARRAY[
          CASE last_eng_type
            WHEN 'replied' THEN 'engaja:responde'
            WHEN 'read'    THEN 'engaja:le'
            WHEN 'delivered' THEN 'engaja:ignora'
            ELSE NULL END,
          CASE
            WHEN total_orders > 0 AND temp IN ('muito_quente','quente') THEN 'cliente:ativo'
            WHEN total_orders > 0 AND temp = 'morno' THEN 'cliente:em_risco'
            WHEN total_orders > 0 AND temp IN ('frio','inerte') THEN 'cliente:perdido'
            WHEN total_orders = 0 AND temp IN ('muito_quente','quente') THEN 'lead:reativo'
            WHEN total_orders = 0 THEN 'lead:novo'
            ELSE NULL END
        ]::text[]
      ) AS new_tags
    FROM scored
  )
  UPDATE customers_unified cu SET
    lead_temperature = t.temp,
    last_engagement_at = t.last_eng_at,
    last_engagement_type = t.last_eng_type,
    dispatch_total_count = t.d_total,
    dispatch_reacted_count = t.d_reacted,
    dispatch_ignored_count = t.d_ignored,
    temperature_updated_at = now(),
    tags = ARRAY(SELECT DISTINCT x FROM unnest(t.new_tags) x WHERE x IS NOT NULL),
    classificacao_disparo = t.disp,
    classificacao_disparo_updated_at = now(),
    dispatch_consecutive_ignored = t.d_ign_streak
  FROM tagged t WHERE cu.id = t.id AND cu.merged_into_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT jsonb_object_agg(lead_temperature, cnt) INTO v_counts FROM (
    SELECT lead_temperature, count(*) cnt FROM customers_unified WHERE lead_temperature IS NOT NULL AND merged_into_id IS NULL GROUP BY 1
  ) x;
  SELECT jsonb_object_agg(classificacao_disparo, cnt) INTO v_counts_disp FROM (
    SELECT classificacao_disparo, count(*) cnt FROM customers_unified WHERE classificacao_disparo IS NOT NULL AND merged_into_id IS NULL GROUP BY 1
  ) y;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'segments', COALESCE(v_counts,'{}'::jsonb),
    'classificacao_disparo', COALESCE(v_counts_disp,'{}'::jsonb),
    'silence_threshold', v_silence_threshold,
    'duration_ms', extract(millisecond FROM clock_timestamp() - v_started)::int
  );
END;
$function$;

-- 5) execute_merge_unified_duplicates: bloqueada
CREATE OR REPLACE FUNCTION public.execute_merge_unified_duplicates(p_dry_run boolean DEFAULT true, p_rule text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Merge automático desativado. phone_suffix8 (grupo Suzan) já executado. Regras cpf/email requerem trava por nome+telefone (Fase 1.5).';
END;
$function$;