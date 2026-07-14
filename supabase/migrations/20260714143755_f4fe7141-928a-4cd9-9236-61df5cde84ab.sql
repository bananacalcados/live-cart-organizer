
-- Índice para lookup rápido de VIP por sufixo de telefone
CREATE INDEX IF NOT EXISTS idx_wa_group_members_phone_suffix8
  ON public.whatsapp_group_members ((right(phone, 8)))
  WHERE left_at IS NULL;

-- Adiciona lista de tags disponíveis (todas as tags existentes em customers_unified)
CREATE OR REPLACE FUNCTION public.audience_filter_options()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'cities', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT city x FROM crm_customers_v WHERE city IS NOT NULL AND city <> '' LIMIT 2000) q),
    'ddds', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT ddd x FROM crm_customers_v WHERE ddd IS NOT NULL AND ddd <> '') q),
    'states', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT state x FROM crm_customers_v WHERE state IS NOT NULL AND state <> '') q),
    'sizes', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT unnest(purchased_sizes) x FROM customers_unified WHERE purchased_sizes IS NOT NULL) q),
    'categories', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT unnest(purchased_categories) x FROM customers_unified WHERE purchased_categories IS NOT NULL) q),
    'brands', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT unnest(purchased_brands) x FROM customers_unified WHERE purchased_brands IS NOT NULL) q),
    'stores', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT unnest(purchased_stores) x FROM customers_unified WHERE purchased_stores IS NOT NULL) q),
    'payment_methods', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT unnest(payment_methods) x FROM customers_unified WHERE payment_methods IS NOT NULL) q),
    'rfm_segments', (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
        SELECT DISTINCT rfm_segment x FROM crm_customers_v WHERE rfm_segment IS NOT NULL AND rfm_segment <> '') q),
    'tags', (SELECT COALESCE(jsonb_agg(t ORDER BY cnt DESC, t), '[]'::jsonb) FROM (
        SELECT unnest(tags) t, count(*) cnt
        FROM customers_unified
        WHERE tags IS NOT NULL
        GROUP BY 1
        HAVING count(*) >= 1
        ORDER BY count(*) DESC
        LIMIT 500) q)
  );
$function$;

-- Extende matcher com filtros de tags e "está em grupo VIP"
CREATE OR REPLACE FUNCTION public.bc_match_audience(cv crm_customers_v, inc jsonb, exc jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  op text;
  d  numeric;
  v_recent timestamptz;
  eff_last timestamptz;
  v_in_vip boolean;
  v_need_vip boolean := (inc ? 'in_vip_group' AND (inc->>'in_vip_group')::boolean IS TRUE)
                     OR (exc ? 'in_vip_group' AND (exc->>'in_vip_group')::boolean IS TRUE);
BEGIN
  -- ===== INCLUDE =====
  IF (inc ? 'sizes')      AND jsonb_array_length(inc->'sizes') > 0
     AND NOT (COALESCE(cv.purchased_sizes,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'sizes'))) THEN RETURN false; END IF;
  IF (inc ? 'categories') AND jsonb_array_length(inc->'categories') > 0
     AND NOT (COALESCE(cv.purchased_categories,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'categories'))) THEN RETURN false; END IF;
  IF (inc ? 'brands')     AND jsonb_array_length(inc->'brands') > 0
     AND NOT (COALESCE(cv.purchased_brands,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'brands'))) THEN RETURN false; END IF;
  IF (inc ? 'stores')     AND jsonb_array_length(inc->'stores') > 0
     AND NOT (COALESCE(cv.purchased_stores,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'stores'))) THEN RETURN false; END IF;
  IF (inc ? 'payment_methods') AND jsonb_array_length(inc->'payment_methods') > 0
     AND NOT (COALESCE(cv.payment_methods,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'payment_methods'))) THEN RETURN false; END IF;
  IF (inc ? 'cities')     AND jsonb_array_length(inc->'cities') > 0
     AND NOT (cv.city = ANY (SELECT jsonb_array_elements_text(inc->'cities'))) THEN RETURN false; END IF;
  IF (inc ? 'ddds')       AND jsonb_array_length(inc->'ddds') > 0
     AND NOT (cv.ddd = ANY (SELECT jsonb_array_elements_text(inc->'ddds'))) THEN RETURN false; END IF;
  IF (inc ? 'states')     AND jsonb_array_length(inc->'states') > 0
     AND NOT (cv.state = ANY (SELECT jsonb_array_elements_text(inc->'states'))) THEN RETURN false; END IF;
  IF (inc ? 'rfm_segments') AND jsonb_array_length(inc->'rfm_segments') > 0
     AND NOT (cv.rfm_segment = ANY (SELECT jsonb_array_elements_text(inc->'rfm_segments'))) THEN RETURN false; END IF;
  IF (inc ? 'tags')       AND jsonb_array_length(inc->'tags') > 0
     AND NOT (COALESCE(cv.tags,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'tags'))) THEN RETURN false; END IF;
  IF (inc ? 'min_avg_ticket')   AND NULLIF(inc->>'min_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) < (inc->>'min_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (inc ? 'max_avg_ticket')   AND NULLIF(inc->>'max_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) > (inc->>'max_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (inc ? 'min_total_orders') AND NULLIF(inc->>'min_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) < (inc->>'min_total_orders')::int THEN RETURN false; END IF;
  IF (inc ? 'max_total_orders') AND NULLIF(inc->>'max_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) > (inc->>'max_total_orders')::int THEN RETURN false; END IF;

  IF NULLIF(inc->>'last_purchase_op','') IS NOT NULL
     OR NULLIF(exc->>'last_purchase_op','') IS NOT NULL THEN
    SELECT max(COALESCE(ps.paid_at, ps.created_at)) INTO v_recent
    FROM public.pos_sales ps
    WHERE ps.customer_unified_id = cv.id
      AND ps.status IN ('paid','completed','finalized','invoiced','pending_pickup','pending_sync');
    eff_last := GREATEST(cv.last_purchase_at, v_recent);
  ELSE
    eff_last := cv.last_purchase_at;
  END IF;

  op := NULLIF(inc->>'last_purchase_op','');
  IF op IS NOT NULL THEN
    IF op = 'gt_days' THEN
      d := NULLIF(inc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND NOT (eff_last IS NOT NULL AND eff_last < now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'lt_days' THEN
      d := NULLIF(inc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND NOT (eff_last IS NOT NULL AND eff_last >= now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'after' THEN
      IF NULLIF(inc->>'last_purchase_from','') IS NOT NULL
         AND NOT (eff_last IS NOT NULL AND eff_last >= (inc->>'last_purchase_from')::date) THEN RETURN false; END IF;
    ELSIF op = 'before' THEN
      IF NULLIF(inc->>'last_purchase_to','') IS NOT NULL
         AND NOT (eff_last IS NOT NULL AND eff_last < ((inc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    ELSIF op = 'between' THEN
      IF NULLIF(inc->>'last_purchase_from','') IS NOT NULL AND NULLIF(inc->>'last_purchase_to','') IS NOT NULL
         AND NOT (eff_last IS NOT NULL
                  AND eff_last >= (inc->>'last_purchase_from')::date
                  AND eff_last < ((inc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    END IF;
  END IF;

  op := NULLIF(inc->>'first_purchase_op','');
  IF op IS NOT NULL THEN
    IF op = 'gt_days' THEN
      d := NULLIF(inc->>'first_purchase_days','')::numeric;
      IF d IS NOT NULL AND NOT (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at < now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'lt_days' THEN
      d := NULLIF(inc->>'first_purchase_days','')::numeric;
      IF d IS NOT NULL AND NOT (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at >= now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'after' THEN
      IF NULLIF(inc->>'first_purchase_from','') IS NOT NULL
         AND NOT (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at >= (inc->>'first_purchase_from')::date) THEN RETURN false; END IF;
    ELSIF op = 'before' THEN
      IF NULLIF(inc->>'first_purchase_to','') IS NOT NULL
         AND NOT (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at < ((inc->>'first_purchase_to')::date + 1)) THEN RETURN false; END IF;
    ELSIF op = 'between' THEN
      IF NULLIF(inc->>'first_purchase_from','') IS NOT NULL AND NULLIF(inc->>'first_purchase_to','') IS NOT NULL
         AND NOT (cv.first_purchase_at IS NOT NULL
                  AND cv.first_purchase_at >= (inc->>'first_purchase_from')::date
                  AND cv.first_purchase_at < ((inc->>'first_purchase_to')::date + 1)) THEN RETURN false; END IF;
    END IF;
  END IF;

  -- ===== EXCLUDE =====
  IF (exc ? 'sizes')      AND jsonb_array_length(exc->'sizes') > 0
     AND (COALESCE(cv.purchased_sizes,'{}') && ARRAY(SELECT jsonb_array_elements_text(exc->'sizes'))) THEN RETURN false; END IF;
  IF (exc ? 'categories') AND jsonb_array_length(exc->'categories') > 0
     AND (COALESCE(cv.purchased_categories,'{}') && ARRAY(SELECT jsonb_array_elements_text(exc->'categories'))) THEN RETURN false; END IF;
  IF (exc ? 'brands')     AND jsonb_array_length(exc->'brands') > 0
     AND (COALESCE(cv.purchased_brands,'{}') && ARRAY(SELECT jsonb_array_elements_text(exc->'brands'))) THEN RETURN false; END IF;
  IF (exc ? 'stores')     AND jsonb_array_length(exc->'stores') > 0
     AND (COALESCE(cv.purchased_stores,'{}') && ARRAY(SELECT jsonb_array_elements_text(exc->'stores'))) THEN RETURN false; END IF;
  IF (exc ? 'payment_methods') AND jsonb_array_length(exc->'payment_methods') > 0
     AND (COALESCE(cv.payment_methods,'{}') && ARRAY(SELECT jsonb_array_elements_text(exc->'payment_methods'))) THEN RETURN false; END IF;
  IF (exc ? 'cities')     AND jsonb_array_length(exc->'cities') > 0
     AND (cv.city = ANY (SELECT jsonb_array_elements_text(exc->'cities'))) THEN RETURN false; END IF;
  IF (exc ? 'ddds')       AND jsonb_array_length(exc->'ddds') > 0
     AND (cv.ddd = ANY (SELECT jsonb_array_elements_text(exc->'ddds'))) THEN RETURN false; END IF;
  IF (exc ? 'states')     AND jsonb_array_length(exc->'states') > 0
     AND (cv.state = ANY (SELECT jsonb_array_elements_text(exc->'states'))) THEN RETURN false; END IF;
  IF (exc ? 'rfm_segments') AND jsonb_array_length(exc->'rfm_segments') > 0
     AND (cv.rfm_segment = ANY (SELECT jsonb_array_elements_text(exc->'rfm_segments'))) THEN RETURN false; END IF;
  IF (exc ? 'tags')       AND jsonb_array_length(exc->'tags') > 0
     AND (COALESCE(cv.tags,'{}') && ARRAY(SELECT jsonb_array_elements_text(exc->'tags'))) THEN RETURN false; END IF;
  IF (exc ? 'min_avg_ticket')   AND NULLIF(exc->>'min_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) >= (exc->>'min_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (exc ? 'max_avg_ticket')   AND NULLIF(exc->>'max_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) <= (exc->>'max_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (exc ? 'min_total_orders') AND NULLIF(exc->>'min_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) >= (exc->>'min_total_orders')::int THEN RETURN false; END IF;
  IF (exc ? 'max_total_orders') AND NULLIF(exc->>'max_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) <= (exc->>'max_total_orders')::int THEN RETURN false; END IF;

  op := NULLIF(exc->>'last_purchase_op','');
  IF op IS NOT NULL THEN
    IF op = 'gt_days' THEN
      d := NULLIF(exc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND (eff_last IS NOT NULL AND eff_last < now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'lt_days' THEN
      d := NULLIF(exc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND (eff_last IS NOT NULL AND eff_last >= now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'after' THEN
      IF NULLIF(exc->>'last_purchase_from','') IS NOT NULL
         AND (eff_last IS NOT NULL AND eff_last >= (exc->>'last_purchase_from')::date) THEN RETURN false; END IF;
    ELSIF op = 'before' THEN
      IF NULLIF(exc->>'last_purchase_to','') IS NOT NULL
         AND (eff_last IS NOT NULL AND eff_last < ((exc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    ELSIF op = 'between' THEN
      IF NULLIF(exc->>'last_purchase_from','') IS NOT NULL AND NULLIF(exc->>'last_purchase_to','') IS NOT NULL
         AND (eff_last IS NOT NULL
              AND eff_last >= (exc->>'last_purchase_from')::date
              AND eff_last < ((exc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    END IF;
  END IF;

  op := NULLIF(exc->>'first_purchase_op','');
  IF op IS NOT NULL THEN
    IF op = 'gt_days' THEN
      d := NULLIF(exc->>'first_purchase_days','')::numeric;
      IF d IS NOT NULL AND (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at < now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'lt_days' THEN
      d := NULLIF(exc->>'first_purchase_days','')::numeric;
      IF d IS NOT NULL AND (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at >= now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'after' THEN
      IF NULLIF(exc->>'first_purchase_from','') IS NOT NULL
         AND (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at >= (exc->>'first_purchase_from')::date) THEN RETURN false; END IF;
    ELSIF op = 'before' THEN
      IF NULLIF(exc->>'first_purchase_to','') IS NOT NULL
         AND (cv.first_purchase_at IS NOT NULL AND cv.first_purchase_at < ((exc->>'first_purchase_to')::date + 1)) THEN RETURN false; END IF;
    ELSIF op = 'between' THEN
      IF NULLIF(exc->>'first_purchase_from','') IS NOT NULL AND NULLIF(exc->>'first_purchase_to','') IS NOT NULL
         AND (cv.first_purchase_at IS NOT NULL
              AND cv.first_purchase_at >= (exc->>'first_purchase_from')::date
              AND cv.first_purchase_at < ((exc->>'first_purchase_to')::date + 1)) THEN RETURN false; END IF;
    END IF;
  END IF;

  -- ===== Está em grupo VIP =====
  IF v_need_vip THEN
    v_in_vip := EXISTS (
      SELECT 1
      FROM public.whatsapp_group_members m
      JOIN public.whatsapp_groups g ON g.group_id = m.group_id
      WHERE g.is_vip = true
        AND m.left_at IS NULL
        AND right(m.phone, 8) = cv.phone_suffix8
    );
    IF (inc ? 'in_vip_group') AND (inc->>'in_vip_group')::boolean IS TRUE AND NOT v_in_vip THEN
      RETURN false;
    END IF;
    IF (exc ? 'in_vip_group') AND (exc->>'in_vip_group')::boolean IS TRUE AND v_in_vip THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$function$;
