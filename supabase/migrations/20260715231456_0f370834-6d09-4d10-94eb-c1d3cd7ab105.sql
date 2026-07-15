
-- ============ 1. FIX get_rfm_summary ============
CREATE OR REPLACE FUNCTION public.get_rfm_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_clientes', (SELECT count(*) FROM customers_unified WHERE merged_into_id IS NULL),
    'clientes_com_rfm', (SELECT count(*) FROM customers_unified WHERE merged_into_id IS NULL AND rfm_segment IS NOT NULL),
    'ticket_medio_geral', COALESCE((SELECT ROUND(AVG(avg_ticket)::numeric, 2) FROM customers_unified WHERE merged_into_id IS NULL AND total_orders > 0), 0),
    'gasto_total_geral', COALESCE((SELECT ROUND(SUM(total_spent)::numeric, 2) FROM customers_unified WHERE merged_into_id IS NULL), 0),
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
        WHERE merged_into_id IS NULL
        GROUP BY 1
      ) t
    ), '{}'::jsonb),
    'por_tamanho', COALESCE((
      SELECT jsonb_object_agg(tam, qt) FROM (
        SELECT COALESCE(NULLIF(shoe_size,''),'nao_informado') AS tam, count(*) AS qt
        FROM customers_unified
        WHERE merged_into_id IS NULL
        GROUP BY 1
        ORDER BY qt DESC
        LIMIT 20
      ) t
    ), '{}'::jsonb),
    'por_regiao', COALESCE((
      SELECT jsonb_object_agg(COALESCE(region_type,'sem_regiao'), qt) FROM (
        SELECT region_type, count(*) AS qt FROM customers_unified
        WHERE merged_into_id IS NULL GROUP BY 1
      ) t
    ), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END $function$;

-- ============ 2. FIX get_dispatch_pressure ============
CREATE OR REPLACE FUNCTION public.get_dispatch_pressure(p_desde date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'toques_por_segmento', COALESCE((
      SELECT jsonb_object_agg(seg, dados) FROM (
        SELECT COALESCE(cu.rfm_segment,'sem_classe') AS seg,
               jsonb_build_object(
                 'contatos_atingidos', count(DISTINCT ce.cliente_id),
                 'toques_totais', count(*),
                 'toques_medios', ROUND(count(*)::numeric / NULLIF(count(DISTINCT ce.cliente_id),0), 2)
               ) AS dados
        FROM campanha_envios ce
        LEFT JOIN customers_unified cu ON cu.id = ce.cliente_id AND cu.merged_into_id IS NULL
        WHERE ce.created_at::date BETWEEN p_desde AND p_ate GROUP BY 1
      ) t
    ), '{}'::jsonb),
    'exposicao_grupos', COALESCE((
      SELECT jsonb_build_object(
        'contatos_expostos', count(DISTINCT unified_id),
        'exposicoes_totais', count(*)
      ) FROM group_message_exposures WHERE created_at::date BETWEEN p_desde AND p_ate
    ), '{}'::jsonb),
    'total_envios', (SELECT count(*) FROM campanha_envios WHERE created_at::date BETWEEN p_desde AND p_ate)
  ) INTO result;
  RETURN result;
END $function$;

-- ============ 3. NEW get_customer_lookup ============
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
        shoe_size, city, state, region_type, birth_date,
        total_orders, total_spent, avg_ticket, total_items,
        first_purchase_at, last_purchase_at,
        rfm_segment, rfm_r, rfm_f, rfm_m, rfm_total,
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

-- ============ 4. NEW get_top_customers ============
CREATE OR REPLACE FUNCTION public.get_top_customers(p_segmento text DEFAULT NULL, p_limite int DEFAULT 20)
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
        shoe_size, city, state, region_type,
        total_orders, total_spent, avg_ticket,
        first_purchase_at, last_purchase_at,
        rfm_segment, rfm_total,
        (now()::date - last_purchase_at::date) AS dias_ultima_compra
      FROM customers_unified
      WHERE merged_into_id IS NULL
        AND total_orders > 0
        AND (p_segmento IS NULL OR rfm_segment = p_segmento)
      ORDER BY total_spent DESC NULLS LAST
      LIMIT LEAST(GREATEST(COALESCE(p_limite,20),1), 100)
    ) x
  ), '[]'::jsonb);
END $function$;

-- ============ 5. NEW get_leads_lookup ============
CREATE OR REPLACE FUNCTION public.get_leads_lookup(p_query text DEFAULT NULL, p_desde date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text;
  v_suffix text;
  v_query_lower text;
  v_desde date := COALESCE(p_desde, (now() - interval '90 days')::date);
  v_ate date := COALESCE(p_ate, now()::date);
BEGIN
  v_digits := regexp_replace(COALESCE(p_query,''), '\D', '', 'g');
  v_suffix := CASE WHEN length(v_digits) >= 8 THEN right(v_digits, 8) ELSE NULL END;
  v_query_lower := lower(trim(COALESCE(p_query,'')));

  RETURN jsonb_build_object(
    'ad_leads', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT id, name, phone, shoe_size, temperature, channel, source, event_id,
               conversation_stage, tags, interested_product_keywords,
               last_ai_contact_at, last_human_contact_at, created_at
        FROM ad_leads
        WHERE created_at::date BETWEEN v_desde AND v_ate
          AND (v_query_lower = '' OR v_query_lower IS NULL
               OR (v_suffix IS NOT NULL AND right(regexp_replace(phone,'\D','','g'), 8) = v_suffix)
               OR name ILIKE '%'||v_query_lower||'%')
        ORDER BY created_at DESC LIMIT 30
      ) x
    ), '[]'::jsonb),
    'event_leads', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT id, event_id, name, phone, instagram, source, referred_count,
               vip_group_sent_at, created_at
        FROM event_leads
        WHERE created_at::date BETWEEN v_desde AND v_ate
          AND (v_query_lower = '' OR v_query_lower IS NULL
               OR (v_suffix IS NOT NULL AND phone_suffix = v_suffix)
               OR name ILIKE '%'||v_query_lower||'%'
               OR instagram ILIKE '%'||regexp_replace(v_query_lower,'^@','')||'%')
        ORDER BY created_at DESC LIMIT 30
      ) x
    ), '[]'::jsonb),
    'lp_leads', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT id, campaign_tag, name, phone, email, instagram, source,
               converted, converted_at, created_at
        FROM lp_leads
        WHERE created_at::date BETWEEN v_desde AND v_ate
          AND (v_query_lower = '' OR v_query_lower IS NULL
               OR (v_suffix IS NOT NULL AND right(regexp_replace(phone,'\D','','g'), 8) = v_suffix)
               OR name ILIKE '%'||v_query_lower||'%'
               OR instagram ILIKE '%'||regexp_replace(v_query_lower,'^@','')||'%')
        ORDER BY created_at DESC LIMIT 30
      ) x
    ), '[]'::jsonb),
    'link_page_leads', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT * FROM link_page_leads
        WHERE created_at::date BETWEEN v_desde AND v_ate
        ORDER BY created_at DESC LIMIT 30
      ) x
    ), '[]'::jsonb),
    'totais_periodo', (SELECT public.get_leads_by_channel(v_desde, v_ate))
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.get_customer_lookup(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_customers(text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_leads_lookup(text, date, date) TO authenticated, service_role;
