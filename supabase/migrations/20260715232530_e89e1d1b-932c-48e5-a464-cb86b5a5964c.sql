
CREATE OR REPLACE FUNCTION public.get_rfm_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_clientes', (SELECT count(*) FROM customers_unified WHERE merged_into_id IS NULL AND is_archived=false),
    'clientes_com_rfm', (SELECT count(*) FROM customers_unified WHERE merged_into_id IS NULL AND is_archived=false AND rfm_segment IS NOT NULL),
    'clientes_com_tamanho', (SELECT count(*) FROM customers_unified WHERE merged_into_id IS NULL AND is_archived=false AND purchased_sizes IS NOT NULL AND array_length(purchased_sizes,1) > 0),
    'ticket_medio_geral', COALESCE((SELECT ROUND(AVG(avg_ticket)::numeric, 2) FROM customers_unified WHERE merged_into_id IS NULL AND is_archived=false AND total_orders > 0), 0),
    'gasto_total_geral', COALESCE((SELECT ROUND(SUM(total_spent)::numeric, 2) FROM customers_unified WHERE merged_into_id IS NULL AND is_archived=false), 0),
    'por_segmento', COALESCE((
      SELECT jsonb_object_agg(seg, dados) FROM (
        SELECT COALESCE(rfm_segment,'sem_classe') AS seg,
          jsonb_build_object(
            'clientes', count(*),
            'ticket_medio', ROUND(AVG(NULLIF(avg_ticket,0))::numeric, 2),
            'gasto_total', ROUND(SUM(total_spent)::numeric, 2),
            'pedidos_totais', SUM(total_orders),
            'dias_desde_ultima_compra_medio', ROUND(AVG(EXTRACT(EPOCH FROM (now() - last_purchase_at))/86400)::numeric, 1)
          ) AS dados
        FROM customers_unified
        WHERE merged_into_id IS NULL AND is_archived=false
        GROUP BY 1
      ) t
    ), '{}'::jsonb),
    'por_calor', COALESCE((
      SELECT jsonb_object_agg(COALESCE(lead_temperature,'sem_calor'), qt) FROM (
        SELECT lead_temperature, count(*) AS qt
        FROM customers_unified
        WHERE merged_into_id IS NULL AND is_archived=false
        GROUP BY 1
      ) t
    ), '{}'::jsonb),
    'por_tamanho', COALESCE((
      SELECT jsonb_object_agg(tam, qt) FROM (
        SELECT tam, count(DISTINCT id) AS qt FROM (
          SELECT id, unnest(purchased_sizes) AS tam
          FROM customers_unified
          WHERE merged_into_id IS NULL AND is_archived=false
            AND purchased_sizes IS NOT NULL AND array_length(purchased_sizes,1) > 0
        ) s
        WHERE tam IS NOT NULL AND btrim(tam) <> ''
        GROUP BY tam
        ORDER BY count(DISTINCT id) DESC
        LIMIT 30
      ) t
    ), '{}'::jsonb),
    'por_regiao', COALESCE((
      SELECT jsonb_object_agg(COALESCE(region_type,'sem_regiao'), qt) FROM (
        SELECT region_type, count(*) AS qt FROM customers_unified
        WHERE merged_into_id IS NULL AND is_archived=false GROUP BY 1
      ) t
    ), '{}'::jsonb),
    'fonte', 'customers_unified.purchased_sizes (compras reais) — mesma base usada pelo filtro de público em PDV > Online > Automação'
  ) INTO result;
  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.get_customer_lookup(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text;
  v_suffix text;
  v_query_lower text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_query,''), '\D', '', 'g');
  v_suffix := CASE WHEN length(v_digits) >= 8 THEN right(v_digits, 8) ELSE NULL END;
  v_query_lower := lower(trim(COALESCE(p_query,'')));

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT
        id, customer_code, name, cpf, email, phone_e164, instagram_handle,
        shoe_size, purchased_sizes, purchased_brands, purchased_categories, purchased_stores, payment_methods,
        city, state, region_type, birth_date,
        total_orders, total_spent, avg_ticket, total_items,
        first_purchase_at, last_purchase_at,
        rfm_segment, rfm_r, rfm_f, rfm_m, rfm_total, lead_temperature,
        cashback_balance, loyalty_points, tags, is_banned,
        (now()::date - last_purchase_at::date) AS dias_ultima_compra
      FROM customers_unified
      WHERE merged_into_id IS NULL
        AND (
          (v_suffix IS NOT NULL AND phone_suffix8 = v_suffix)
          OR (length(v_digits) = 11 AND cpf = v_digits)
          OR (v_query_lower <> '' AND name ILIKE '%'||v_query_lower||'%')
          OR (v_query_lower <> '' AND instagram_handle ILIKE '%'||regexp_replace(v_query_lower,'^@','')||'%')
          OR (v_query_lower LIKE '%@%' AND email ILIKE v_query_lower)
          OR (customer_code = upper(trim(p_query)))
        )
      ORDER BY total_spent DESC NULLS LAST
      LIMIT 20
    ) x
  ), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.get_top_customers(p_segmento text DEFAULT NULL::text, p_limite integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT
        id, customer_code, name, phone_e164, instagram_handle,
        shoe_size, purchased_sizes, purchased_stores, purchased_categories,
        city, state, region_type,
        total_orders, total_spent, avg_ticket,
        first_purchase_at, last_purchase_at,
        rfm_segment, rfm_total, lead_temperature,
        (now()::date - last_purchase_at::date) AS dias_ultima_compra
      FROM customers_unified
      WHERE merged_into_id IS NULL
        AND is_archived = false
        AND total_orders > 0
        AND (p_segmento IS NULL OR rfm_segment = p_segmento)
      ORDER BY total_spent DESC NULLS LAST
      LIMIT LEAST(GREATEST(COALESCE(p_limite,20),1), 100)
    ) x
  ), '[]'::jsonb);
END $function$;
