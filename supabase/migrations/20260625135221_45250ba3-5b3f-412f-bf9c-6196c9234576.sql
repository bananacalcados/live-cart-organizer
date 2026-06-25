-- ============ 1) templates_carrossel: múltiplos modelos por contagem ============
ALTER TABLE public.templates_carrossel
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS nome text NOT NULL DEFAULT 'Padrão';

-- Trocar PK de qtd_cards para id
ALTER TABLE public.templates_carrossel DROP CONSTRAINT IF EXISTS templates_carrossel_pkey;
ALTER TABLE public.templates_carrossel ADD CONSTRAINT templates_carrossel_pkey PRIMARY KEY (id);

-- Índice único por instância + modelo + contagem
CREATE UNIQUE INDEX IF NOT EXISTS templates_carrossel_inst_nome_qtd_uidx
  ON public.templates_carrossel (whatsapp_number_id, nome, qtd_cards);

-- ============ 2) campanhas_auto: instância + modelo de template ============
ALTER TABLE public.campanhas_auto
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_modelo text;

-- ============ 3) bc_match_audience: período de compra + RFM ============
CREATE OR REPLACE FUNCTION public.bc_match_audience(cv crm_customers_v, inc jsonb, exc jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  op text;
  d  numeric;
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
  IF (inc ? 'min_avg_ticket')   AND NULLIF(inc->>'min_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) < (inc->>'min_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (inc ? 'max_avg_ticket')   AND NULLIF(inc->>'max_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) > (inc->>'max_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (inc ? 'min_total_orders') AND NULLIF(inc->>'min_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) < (inc->>'min_total_orders')::int THEN RETURN false; END IF;
  IF (inc ? 'max_total_orders') AND NULLIF(inc->>'max_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) > (inc->>'max_total_orders')::int THEN RETURN false; END IF;

  -- Período da última compra (INCLUDE)
  op := NULLIF(inc->>'last_purchase_op','');
  IF op IS NOT NULL THEN
    IF op = 'gt_days' THEN
      d := NULLIF(inc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND NOT (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at < now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'lt_days' THEN
      d := NULLIF(inc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND NOT (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at >= now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'after' THEN
      IF NULLIF(inc->>'last_purchase_from','') IS NOT NULL
         AND NOT (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at >= (inc->>'last_purchase_from')::date) THEN RETURN false; END IF;
    ELSIF op = 'before' THEN
      IF NULLIF(inc->>'last_purchase_to','') IS NOT NULL
         AND NOT (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at < ((inc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    ELSIF op = 'between' THEN
      IF NULLIF(inc->>'last_purchase_from','') IS NOT NULL AND NULLIF(inc->>'last_purchase_to','') IS NOT NULL
         AND NOT (cv.last_purchase_at IS NOT NULL
                  AND cv.last_purchase_at >= (inc->>'last_purchase_from')::date
                  AND cv.last_purchase_at < ((inc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
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
  IF (exc ? 'min_avg_ticket')   AND NULLIF(exc->>'min_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) >= (exc->>'min_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (exc ? 'max_avg_ticket')   AND NULLIF(exc->>'max_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) <= (exc->>'max_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (exc ? 'min_total_orders') AND NULLIF(exc->>'min_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) >= (exc->>'min_total_orders')::int THEN RETURN false; END IF;
  IF (exc ? 'max_total_orders') AND NULLIF(exc->>'max_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) <= (exc->>'max_total_orders')::int THEN RETURN false; END IF;

  -- Período da última compra (EXCLUDE)
  op := NULLIF(exc->>'last_purchase_op','');
  IF op IS NOT NULL THEN
    IF op = 'gt_days' THEN
      d := NULLIF(exc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at < now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'lt_days' THEN
      d := NULLIF(exc->>'last_purchase_days','')::numeric;
      IF d IS NOT NULL AND (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at >= now() - (d || ' days')::interval) THEN RETURN false; END IF;
    ELSIF op = 'after' THEN
      IF NULLIF(exc->>'last_purchase_from','') IS NOT NULL
         AND (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at >= (exc->>'last_purchase_from')::date) THEN RETURN false; END IF;
    ELSIF op = 'before' THEN
      IF NULLIF(exc->>'last_purchase_to','') IS NOT NULL
         AND (cv.last_purchase_at IS NOT NULL AND cv.last_purchase_at < ((exc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    ELSIF op = 'between' THEN
      IF NULLIF(exc->>'last_purchase_from','') IS NOT NULL AND NULLIF(exc->>'last_purchase_to','') IS NOT NULL
         AND (cv.last_purchase_at IS NOT NULL
              AND cv.last_purchase_at >= (exc->>'last_purchase_from')::date
              AND cv.last_purchase_at < ((exc->>'last_purchase_to')::date + 1)) THEN RETURN false; END IF;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

-- ============ 4) audience_filter_options: + rfm_segments ============
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
        SELECT DISTINCT rfm_segment x FROM crm_customers_v WHERE rfm_segment IS NOT NULL AND rfm_segment <> '') q)
  );
$function$;

-- ============ 5) resolve_campaign_template: instância + modelo ============
CREATE OR REPLACE FUNCTION public.resolve_campaign_template(p_campanha_id uuid)
 RETURNS templates_carrossel
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.campanhas_auto;
  v_ok_count integer;
  v_tpl public.templates_carrossel;
BEGIN
  SELECT * INTO c FROM public.campanhas_auto WHERE id = p_campanha_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_ok_count
  FROM public.campanha_cards
  WHERE campanha_id = p_campanha_id AND status = 'ok';

  IF v_ok_count < 2 THEN RETURN NULL; END IF;
  IF v_ok_count > 10 THEN v_ok_count := 10; END IF;

  SELECT * INTO v_tpl
  FROM public.templates_carrossel t
  WHERE t.qtd_cards = v_ok_count
    AND t.aprovado = true
    AND (c.whatsapp_number_id IS NULL OR t.whatsapp_number_id = c.whatsapp_number_id)
    AND (c.template_modelo IS NULL OR t.nome = c.template_modelo)
  ORDER BY
    (t.whatsapp_number_id = c.whatsapp_number_id) DESC NULLS LAST,
    (t.nome = COALESCE(c.template_modelo, 'Padrão')) DESC,
    t.updated_at DESC
  LIMIT 1;

  RETURN v_tpl;
END;
$function$;