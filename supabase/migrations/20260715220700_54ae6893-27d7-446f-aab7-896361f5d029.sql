
-- =====================================================================
-- get_sales_vs_goals v3: separa Live embutida nas lojas físicas,
-- espelha meta Shopify em Live, adiciona agregador shopify_mais_live.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_sales_vs_goals(p_mes_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d_start date := to_date(p_mes_ref || '-01', 'YYYY-MM-DD');
  d_end date := (to_date(p_mes_ref || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  today_br date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  days_elapsed int;
  days_total int := ((to_date(p_mes_ref || '-01', 'YYYY-MM-DD') + interval '1 month')::date - to_date(p_mes_ref || '-01', 'YYYY-MM-DD'));
  result jsonb;
BEGIN
  days_elapsed := GREATEST(1, LEAST(GREATEST(today_br, d_start), d_end - 1) - d_start + 1);

  WITH
  stores AS (
    SELECT
      s.id AS store_id,
      s.name AS loja_nome,
      CASE
        WHEN lower(unaccent(s.name)) LIKE '%perola%' THEN 'perola'
        WHEN lower(unaccent(s.name)) LIKE '%centro%' AND lower(unaccent(s.name)) NOT LIKE '%site%' THEN 'centro'
        WHEN lower(unaccent(s.name)) LIKE '%shopify%' THEN 'shopify'
        WHEN lower(unaccent(s.name)) LIKE '%live%' THEN 'live'
        ELSE 'outras'
      END AS loja
    FROM public.pos_stores s
    WHERE s.is_active = true
      AND COALESCE(s.is_simulation, false) = false
  ),
  goal_candidates AS (
    SELECT
      g.id, g.store_id, st.loja, st.loja_nome,
      g.goal_value::numeric AS meta,
      g.period, g.period_start, g.period_end, g.created_at,
      CASE
        WHEN g.period = 'custom'
         AND g.period_start IS NOT NULL AND g.period_end IS NOT NULL
         AND g.period_start <= (d_end - 1) AND g.period_end >= d_start
        THEN 1
        WHEN g.period = 'monthly' THEN 2
        ELSE 9
      END AS prioridade
    FROM public.pos_goals g
    JOIN stores st ON st.store_id = g.store_id
    WHERE g.is_active = true
      AND g.goal_type = 'revenue'
      AND g.seller_id IS NULL
      AND (
        (g.period = 'custom' AND g.period_start IS NOT NULL AND g.period_end IS NOT NULL
         AND g.period_start <= (d_end - 1) AND g.period_end >= d_start)
        OR g.period = 'monthly'
      )
  ),
  metas_pdv AS (
    SELECT DISTINCT ON (store_id)
      store_id, loja, loja_nome, meta,
      id AS goal_id, period, period_start, period_end, created_at
    FROM goal_candidates
    WHERE prioridade < 9
    ORDER BY store_id, prioridade, created_at DESC
  ),
  metas_manuais AS (
    SELECT
      NULL::uuid AS store_id, g.loja,
      CASE g.loja
        WHEN 'perola' THEN 'Loja Perola'
        WHEN 'centro' THEN 'Loja Centro'
        WHEN 'shopify' THEN 'Tiny Shopify'
        WHEN 'live' THEN 'Live'
        WHEN 'total' THEN 'Total'
        ELSE g.loja
      END AS loja_nome,
      g.meta_faturamento_brl::numeric AS meta,
      g.id AS goal_id, 'monthly_goals'::text AS period,
      d_start AS period_start, (d_end - 1) AS period_end, g.created_at
    FROM public.monthly_goals g
    WHERE g.mes_ref = p_mes_ref
      AND NOT EXISTS (SELECT 1 FROM metas_pdv mp WHERE mp.loja = g.loja)
  ),
  metas_base AS (
    SELECT *, 'pos_goals'::text AS fonte FROM metas_pdv
    UNION ALL
    SELECT *, 'monthly_goals'::text AS fonte FROM metas_manuais
  ),
  -- Se não houver meta 'live', espelha a meta 'shopify' (regra de negócio).
  meta_shopify AS (
    SELECT * FROM metas_base WHERE loja = 'shopify' LIMIT 1
  ),
  metas_live_espelhada AS (
    SELECT
      NULL::uuid AS store_id, 'live'::text AS loja, 'Live'::text AS loja_nome,
      ms.meta, ms.goal_id, ms.period, ms.period_start, ms.period_end, ms.created_at,
      'espelhada_shopify'::text AS fonte
    FROM meta_shopify ms
    WHERE NOT EXISTS (SELECT 1 FROM metas_base WHERE loja = 'live')
  ),
  metas AS (
    SELECT * FROM metas_base
    UNION ALL
    SELECT * FROM metas_live_espelhada
  ),
  -- vendas de Live embutidas em cada store físico (excluídas do balcão)
  vendas_live_por_store AS (
    SELECT s.store_id, SUM(s.total)::numeric AS live_embutida
    FROM public.pos_sales s
    WHERE s.status IN ('completed', 'pending_sync', 'paid')
      AND s.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND s.sale_type IN ('live', 'live_shopping')
      AND (
        (s.paid_at IS NOT NULL AND s.paid_at >= d_start AND s.paid_at < d_end)
        OR (s.paid_at IS NULL AND s.created_at >= d_start AND s.created_at < d_end)
      )
    GROUP BY s.store_id
  ),
  -- realizado PURO da loja (sem live) — evita duplo-count com canal Live
  vendas_por_store AS (
    SELECT s.store_id, SUM(s.total)::numeric AS realizado
    FROM public.pos_sales s
    WHERE s.status IN ('completed', 'pending_sync', 'paid')
      AND s.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND COALESCE(s.sale_type, '') NOT IN ('live', 'live_shopping')
      AND (
        (s.paid_at IS NOT NULL AND s.paid_at >= d_start AND s.paid_at < d_end)
        OR (s.paid_at IS NULL AND s.created_at >= d_start AND s.created_at < d_end)
      )
    GROUP BY s.store_id
  ),
  -- canal Live agregado (todas as vendas Live, independente do store físico)
  vendas_live_total AS (
    SELECT 'live'::text AS loja, COALESCE(SUM(s.total), 0)::numeric AS realizado
    FROM public.pos_sales s
    WHERE s.status IN ('completed', 'pending_sync', 'paid')
      AND s.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND s.sale_type IN ('live', 'live_shopping')
      AND (
        (s.paid_at IS NOT NULL AND s.paid_at >= d_start AND s.paid_at < d_end)
        OR (s.paid_at IS NULL AND s.created_at >= d_start AND s.created_at < d_end)
      )
  ),
  linhas_base AS (
    SELECT
      m.loja, m.loja_nome, m.store_id, m.goal_id, m.fonte,
      m.period, m.period_start, m.period_end, m.meta,
      CASE
        WHEN m.loja = 'live' THEN COALESCE((SELECT realizado FROM vendas_live_total), 0)
        WHEN m.store_id IS NOT NULL THEN COALESCE(vs.realizado, 0)
        ELSE 0
      END AS realizado,
      CASE
        WHEN m.loja = 'live' THEN 0
        WHEN m.store_id IS NOT NULL THEN COALESCE(vls.live_embutida, 0)
        ELSE 0
      END AS live_embutida
    FROM metas m
    LEFT JOIN vendas_por_store vs ON vs.store_id = m.store_id
    LEFT JOIN vendas_live_por_store vls ON vls.store_id = m.store_id
    WHERE m.loja <> 'total'
  ),
  -- lojas físicas com vendas mas sem meta cadastrada (mantém compatibilidade)
  vendas_sem_meta AS (
    SELECT
      COALESCE(st.loja, 'outras') AS loja,
      COALESCE(st.loja_nome, 'Outras lojas/canais') AS loja_nome,
      ps.store_id, NULL::uuid AS goal_id, 'sem_meta'::text AS fonte,
      NULL::text AS period, NULL::date AS period_start, NULL::date AS period_end,
      0::numeric AS meta,
      SUM(ps.total)::numeric AS realizado,
      SUM(CASE WHEN ps.sale_type IN ('live','live_shopping') THEN ps.total ELSE 0 END)::numeric AS live_embutida
    FROM public.pos_sales ps
    LEFT JOIN stores st ON st.store_id = ps.store_id
    WHERE ps.status IN ('completed', 'pending_sync', 'paid')
      AND ps.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND (
        (ps.paid_at IS NOT NULL AND ps.paid_at >= d_start AND ps.paid_at < d_end)
        OR (ps.paid_at IS NULL AND ps.created_at >= d_start AND ps.created_at < d_end)
      )
      AND ps.store_id NOT IN (SELECT store_id FROM linhas_base WHERE store_id IS NOT NULL)
    GROUP BY st.loja, st.loja_nome, ps.store_id
    HAVING SUM(ps.total) > 0
  ),
  linhas AS (
    SELECT * FROM linhas_base
    UNION ALL
    SELECT * FROM vendas_sem_meta
  ),
  seller_goals AS (
    SELECT
      st.loja, st.loja_nome, ps.name AS vendedor,
      g.goal_value::numeric AS meta,
      COALESCE(SUM(sa.total), 0)::numeric AS realizado,
      g.id AS goal_id, g.period, g.period_start, g.period_end
    FROM public.pos_goals g
    JOIN stores st ON st.store_id = g.store_id
    LEFT JOIN public.pos_sellers ps ON ps.id = g.seller_id
    LEFT JOIN public.pos_sales sa ON sa.seller_id = g.seller_id
      AND sa.store_id = g.store_id
      AND sa.status IN ('completed', 'pending_sync', 'paid')
      AND sa.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND (
        (sa.paid_at IS NOT NULL AND sa.paid_at >= d_start AND sa.paid_at < d_end)
        OR (sa.paid_at IS NULL AND sa.created_at >= d_start AND sa.created_at < d_end)
      )
    WHERE g.is_active = true
      AND g.goal_type = 'seller_revenue'
      AND g.seller_id IS NOT NULL
      AND (
        (g.period = 'custom' AND g.period_start IS NOT NULL AND g.period_end IS NOT NULL
         AND g.period_start <= (d_end - 1) AND g.period_end >= d_start)
        OR g.period = 'monthly'
      )
    GROUP BY st.loja, st.loja_nome, ps.name, g.goal_value, g.id, g.period, g.period_start, g.period_end
  )
  SELECT jsonb_build_object(
    'mes_ref', p_mes_ref,
    'periodo_inicio', d_start,
    'periodo_fim', d_end - 1,
    'dias_decorridos', days_elapsed,
    'dias_totais', days_total,
    'fonte_metas', 'pos_goals do PDV (oficial); monthly_goals apenas quando não houver meta no PDV; meta de Live espelha a de Tiny Shopify quando não houver meta própria',
    'path_metas_oficial', 'public.pos_goals -> public.pos_stores',
    'regra_live', 'Vendas com sale_type IN (live, live_shopping) são atribuídas ao CANAL Live e REMOVIDAS do realizado das lojas físicas para evitar duplo-contagem. O campo live_embutida mostra quanto de Live foi registrado dentro de cada loja física.',
    'por_loja', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'loja', loja,
        'loja_nome', loja_nome,
        'store_id', store_id,
        'meta_goal_id', goal_id,
        'fonte_meta', fonte,
        'periodo_meta', period,
        'period_start', period_start,
        'period_end', period_end,
        'meta', meta,
        'realizado', realizado,
        'realizado_loja_pura', realizado,
        'live_embutida_na_loja', live_embutida,
        'realizado_total_incluindo_live', realizado + live_embutida,
        'projecao_linear', ROUND(realizado * days_total::numeric / NULLIF(days_elapsed, 0), 2),
        'pct_meta', CASE WHEN meta > 0 THEN ROUND(realizado * 100 / meta, 1) ELSE NULL END,
        'falta', GREATEST(0, meta - realizado)
      ) ORDER BY
        CASE loja WHEN 'perola' THEN 1 WHEN 'centro' THEN 2 WHEN 'shopify' THEN 3 WHEN 'live' THEN 4 WHEN 'outras' THEN 5 ELSE 9 END,
        loja_nome)
      FROM linhas
    ), '[]'::jsonb),
    'shopify_mais_live', (
      SELECT jsonb_build_object(
        'descricao', 'Meta digital (Tiny Shopify) considerando Live como parte do mesmo funil',
        'meta', COALESCE((SELECT meta FROM linhas WHERE loja = 'shopify' LIMIT 1), 0),
        'realizado_shopify', COALESCE((SELECT realizado FROM linhas WHERE loja = 'shopify' LIMIT 1), 0),
        'realizado_live', COALESCE((SELECT realizado FROM linhas WHERE loja = 'live' LIMIT 1), 0),
        'realizado_combinado',
          COALESCE((SELECT realizado FROM linhas WHERE loja = 'shopify' LIMIT 1), 0) +
          COALESCE((SELECT realizado FROM linhas WHERE loja = 'live' LIMIT 1), 0),
        'pct_meta',
          CASE WHEN COALESCE((SELECT meta FROM linhas WHERE loja = 'shopify' LIMIT 1), 0) > 0
               THEN ROUND(
                 (COALESCE((SELECT realizado FROM linhas WHERE loja = 'shopify' LIMIT 1), 0) +
                  COALESCE((SELECT realizado FROM linhas WHERE loja = 'live' LIMIT 1), 0)
                 ) * 100 / (SELECT meta FROM linhas WHERE loja = 'shopify' LIMIT 1), 1)
               ELSE NULL END
      )
    ),
    'metas_vendedoras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'loja', loja, 'loja_nome', loja_nome, 'vendedor', vendedor,
        'meta_goal_id', goal_id, 'periodo_meta', period,
        'period_start', period_start, 'period_end', period_end,
        'meta', meta, 'realizado', realizado,
        'pct_meta', CASE WHEN meta > 0 THEN ROUND(realizado * 100 / meta, 1) ELSE NULL END,
        'falta', GREATEST(0, meta - realizado)
      ) ORDER BY loja_nome, vendedor)
      FROM seller_goals
    ), '[]'::jsonb),
    'total_consolidado', COALESCE((
      SELECT jsonb_build_object(
        'meta', SUM(DISTINCT_meta),
        'realizado', SUM(realizado),
        'projecao_linear', ROUND(SUM(realizado) * days_total::numeric / NULLIF(days_elapsed, 0), 2),
        'pct_meta', CASE WHEN SUM(DISTINCT_meta) > 0 THEN ROUND(SUM(realizado) * 100 / SUM(DISTINCT_meta), 1) ELSE NULL END,
        'falta', GREATEST(0, SUM(DISTINCT_meta) - SUM(realizado))
      )
      FROM (
        -- evita contar a meta Shopify duas vezes (Shopify + Live espelhada)
        SELECT realizado,
               CASE WHEN loja = 'live' AND fonte = 'espelhada_shopify' THEN 0 ELSE meta END AS DISTINCT_meta
        FROM linhas
        WHERE meta > 0 OR loja = 'live'
      ) t
    ), jsonb_build_object('meta', 0, 'realizado', 0, 'projecao_linear', 0, 'pct_meta', NULL, 'falta', 0))
  ) INTO result;

  RETURN result;
END
$function$;

-- =====================================================================
-- get_events_performance: performance por evento no mês (módulo Eventos)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_events_performance(p_mes_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d_start date := to_date(p_mes_ref || '-01', 'YYYY-MM-DD');
  d_end date := (to_date(p_mes_ref || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  result jsonb;
BEGIN
  WITH evts AS (
    SELECT e.id, e.name, e.channel, e.start_date, e.created_at
    FROM public.events e
    WHERE
      (e.start_date IS NOT NULL AND e.start_date >= d_start AND e.start_date < d_end)
      OR (e.start_date IS NULL AND e.created_at >= d_start AND e.created_at < d_end)
  ),
  ords AS (
    SELECT
      o.event_id,
      COUNT(*) AS orders_count,
      COUNT(*) FILTER (WHERE o.is_paid = true OR o.paid_externally = true) AS paid_count,
      COALESCE(SUM(
        CASE
          WHEN o.is_paid = true OR o.paid_externally = true
          THEN (
            SELECT COALESCE(SUM((p->>'price')::numeric * (p->>'quantity')::numeric), 0)
            FROM jsonb_array_elements(COALESCE(o.products, '[]'::jsonb)) p
          )
          ELSE 0
        END
      ), 0) AS revenue_paid,
      COALESCE(SUM((
        SELECT COALESCE(SUM((p->>'price')::numeric * (p->>'quantity')::numeric), 0)
        FROM jsonb_array_elements(COALESCE(o.products, '[]'::jsonb)) p
      )), 0) AS revenue_total
    FROM public.orders o
    WHERE o.event_id IN (SELECT id FROM evts)
    GROUP BY o.event_id
  )
  SELECT jsonb_build_object(
    'mes_ref', p_mes_ref,
    'periodo_inicio', d_start,
    'periodo_fim', d_end - 1,
    'total_eventos', (SELECT COUNT(*) FROM evts),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id', e.id,
        'nome', e.name,
        'canal', e.channel,
        'canal_descricao', CASE e.channel
          WHEN 'site' THEN 'Site / Tiny Shopify'
          WHEN 'pos_perola' THEN 'Loja Pérola'
          WHEN 'pos_centro' THEN 'Loja Centro'
          ELSE COALESCE(e.channel, 'não definido')
        END,
        'data_evento', COALESCE(e.start_date, e.created_at::date),
        'pedidos', COALESCE(o.orders_count, 0),
        'pedidos_pagos', COALESCE(o.paid_count, 0),
        'receita_paga', COALESCE(o.revenue_paid, 0),
        'receita_total', COALESCE(o.revenue_total, 0),
        'conversao_pct', CASE WHEN COALESCE(o.orders_count,0) > 0
          THEN ROUND(COALESCE(o.paid_count,0) * 100.0 / o.orders_count, 1) ELSE 0 END
      ) ORDER BY COALESCE(e.start_date, e.created_at::date) DESC)
      FROM evts e LEFT JOIN ords o ON o.event_id = e.id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END
$function$;
