-- =========================================================
-- Helper: aplica filtro include/exclude e devolve clientes elegíveis
-- =========================================================
-- Atualiza select_campaign_batch para suportar include/exclude + novas dimensões
CREATE OR REPLACE FUNCTION public.select_campaign_batch(
  p_campanha_id uuid,
  p_limit integer DEFAULT NULL,
  p_global_cap_days integer DEFAULT 7
)
RETURNS TABLE (
  cliente_id uuid,
  phone text,
  phone_suffix8 text,
  nome text,
  primeiro_nome text,
  tamanhos text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.campanhas_auto;
  v_limit integer;
  f jsonb;
  inc jsonb;
  exc jsonb;
BEGIN
  SELECT * INTO c FROM public.campanhas_auto WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_limit := COALESCE(p_limit, c.qtd_por_dia, 50);
  f := COALESCE(c.filtro_json, '{}'::jsonb);
  -- Compatibilidade: se não houver chaves include/exclude, trata tudo como include (legado)
  IF f ? 'include' OR f ? 'exclude' THEN
    inc := COALESCE(f->'include', '{}'::jsonb);
    exc := COALESCE(f->'exclude', '{}'::jsonb);
  ELSE
    inc := f;
    exc := '{}'::jsonb;
  END IF;

  RETURN QUERY
  SELECT cv.id, cv.phone, cv.phone_suffix8, cv.name, cv.first_name, cv.purchased_sizes
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    AND public.bc_match_audience(cv, inc, exc)
    -- Carência da própria campanha
    AND NOT EXISTS (
      SELECT 1 FROM public.campanha_envios ce
      WHERE ce.campanha_id = c.id
        AND ce.phone_suffix8 = cv.phone_suffix8
        AND ce.status IN ('enviado','entregue','lido')
        AND ce.enviado_em >= now() - (c.cooldown_dias || ' days')::interval
    )
    -- Teto global de marketing
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_envios_globais g
      WHERE g.phone_suffix8 = cv.phone_suffix8
        AND g.enviado_em >= now() - (p_global_cap_days || ' days')::interval
    )
  ORDER BY cv.last_purchase_at ASC NULLS FIRST
  LIMIT v_limit;
END;
$$;

-- =========================================================
-- Função de match (include/exclude) — recebe a linha da view
-- =========================================================
CREATE OR REPLACE FUNCTION public.bc_match_audience(
  cv public.crm_customers_v,
  inc jsonb,
  exc jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  -- ===== INCLUDE (restringe; cada bloco só aplica quando informado) =====
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
  IF (inc ? 'min_avg_ticket')   AND NULLIF(inc->>'min_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) < (inc->>'min_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (inc ? 'max_avg_ticket')   AND NULLIF(inc->>'max_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) > (inc->>'max_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (inc ? 'min_total_orders') AND NULLIF(inc->>'min_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) < (inc->>'min_total_orders')::int THEN RETURN false; END IF;
  IF (inc ? 'max_total_orders') AND NULLIF(inc->>'max_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) > (inc->>'max_total_orders')::int THEN RETURN false; END IF;

  -- ===== EXCLUDE (remove quem casar; cada bloco só aplica quando informado) =====
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
  IF (exc ? 'min_avg_ticket')   AND NULLIF(exc->>'min_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) >= (exc->>'min_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (exc ? 'max_avg_ticket')   AND NULLIF(exc->>'max_avg_ticket','') IS NOT NULL
     AND COALESCE(cv.avg_ticket,0) <= (exc->>'max_avg_ticket')::numeric THEN RETURN false; END IF;
  IF (exc ? 'min_total_orders') AND NULLIF(exc->>'min_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) >= (exc->>'min_total_orders')::int THEN RETURN false; END IF;
  IF (exc ? 'max_total_orders') AND NULLIF(exc->>'max_total_orders','') IS NOT NULL
     AND COALESCE(cv.total_orders,0) <= (exc->>'max_total_orders')::int THEN RETURN false; END IF;

  RETURN true;
END;
$$;

-- =========================================================
-- Contagem ao vivo do público (preview)
-- =========================================================
CREATE OR REPLACE FUNCTION public.count_campaign_audience(p_filtro jsonb)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f jsonb := COALESCE(p_filtro, '{}'::jsonb);
  inc jsonb;
  exc jsonb;
  v_count integer;
BEGIN
  IF f ? 'include' OR f ? 'exclude' THEN
    inc := COALESCE(f->'include', '{}'::jsonb);
    exc := COALESCE(f->'exclude', '{}'::jsonb);
  ELSE
    inc := f;
    exc := '{}'::jsonb;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    AND public.bc_match_audience(cv, inc, exc);

  RETURN v_count;
END;
$$;

-- =========================================================
-- Valores disponíveis para preencher os seletores
-- =========================================================
CREATE OR REPLACE FUNCTION public.audience_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        SELECT DISTINCT unnest(payment_methods) x FROM customers_unified WHERE payment_methods IS NOT NULL) q)
  );
$$;

REVOKE ALL ON FUNCTION public.count_campaign_audience(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audience_filter_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_campaign_audience(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.audience_filter_options() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.select_campaign_batch(uuid, integer, integer) TO authenticated, service_role;