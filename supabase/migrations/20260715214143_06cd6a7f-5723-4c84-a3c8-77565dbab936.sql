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
      g.id,
      g.store_id,
      st.loja,
      st.loja_nome,
      g.goal_value::numeric AS meta,
      g.period,
      g.period_start,
      g.period_end,
      g.created_at,
      CASE
        WHEN g.period = 'custom'
         AND g.period_start IS NOT NULL
         AND g.period_end IS NOT NULL
         AND g.period_start <= (d_end - 1)
         AND g.period_end >= d_start
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
        (g.period = 'custom'
         AND g.period_start IS NOT NULL
         AND g.period_end IS NOT NULL
         AND g.period_start <= (d_end - 1)
         AND g.period_end >= d_start)
        OR g.period = 'monthly'
      )
  ),
  metas_pdv AS (
    SELECT DISTINCT ON (store_id)
      store_id,
      loja,
      loja_nome,
      meta,
      id AS goal_id,
      period,
      period_start,
      period_end,
      created_at
    FROM goal_candidates
    WHERE prioridade < 9
    ORDER BY store_id, prioridade, created_at DESC
  ),
  metas_manuais AS (
    SELECT
      NULL::uuid AS store_id,
      g.loja,
      CASE g.loja
        WHEN 'perola' THEN 'Loja Perola'
        WHEN 'centro' THEN 'Loja Centro'
        WHEN 'shopify' THEN 'Tiny Shopify'
        WHEN 'live' THEN 'Live'
        WHEN 'total' THEN 'Total'
        ELSE g.loja
      END AS loja_nome,
      g.meta_faturamento_brl::numeric AS meta,
      g.id AS goal_id,
      'monthly_goals'::text AS period,
      d_start AS period_start,
      (d_end - 1) AS period_end,
      g.created_at
    FROM public.monthly_goals g
    WHERE g.mes_ref = p_mes_ref
      AND NOT EXISTS (
        SELECT 1 FROM metas_pdv mp WHERE mp.loja = g.loja
      )
  ),
  metas AS (
    SELECT *, 'pos_goals'::text AS fonte FROM metas_pdv
    UNION ALL
    SELECT *, 'monthly_goals'::text AS fonte FROM metas_manuais
  ),
  vendas_por_store AS (
    SELECT
      s.store_id,
      SUM(s.total)::numeric AS realizado
    FROM public.pos_sales s
    WHERE s.status IN ('completed', 'pending_sync', 'paid')
      AND s.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND (
        (s.paid_at IS NOT NULL AND s.paid_at >= d_start AND s.paid_at < d_end)
        OR (s.paid_at IS NULL AND s.created_at >= d_start AND s.created_at < d_end)
      )
    GROUP BY s.store_id
  ),
  vendas_por_loja AS (
    SELECT
      CASE
        WHEN ps.sale_type IN ('live', 'live_shopping') THEN 'live'
        ELSE COALESCE(st.loja, 'outras')
      END AS loja,
      SUM(ps.total)::numeric AS realizado
    FROM public.pos_sales ps
    LEFT JOIN stores st ON st.store_id = ps.store_id
    WHERE ps.status IN ('completed', 'pending_sync', 'paid')
      AND ps.revenue_attribution <> 'site_pickup_only'::public.pos_revenue_attribution
      AND (
        (ps.paid_at IS NOT NULL AND ps.paid_at >= d_start AND ps.paid_at < d_end)
        OR (ps.paid_at IS NULL AND ps.created_at >= d_start AND ps.created_at < d_end)
      )
    GROUP BY 1
  ),
  linhas_base AS (
    SELECT
      m.loja,
      m.loja_nome,
      m.store_id,
      m.goal_id,
      m.fonte,
      m.period,
      m.period_start,
      m.period_end,
      m.meta,
      CASE
        WHEN m.store_id IS NOT NULL THEN COALESCE(vs.realizado, 0)
        ELSE COALESCE(vl.realizado, 0)
      END AS realizado
    FROM metas m
    LEFT JOIN vendas_por_store vs ON vs.store_id = m.store_id
    LEFT JOIN vendas_por_loja vl ON vl.loja = m.loja
    WHERE m.loja <> 'total'
  ),
  vendas_sem_meta AS (
    SELECT
      vl.loja,
      CASE vl.loja
        WHEN 'live' THEN 'Live'
        WHEN 'outras' THEN 'Outras lojas/canais'
        ELSE vl.loja
      END AS loja_nome,
      NULL::uuid AS store_id,
      NULL::uuid AS goal_id,
      'sem_meta'::text AS fonte,
      NULL::text AS period,
      NULL::date AS period_start,
      NULL::date AS period_end,
      0::numeric AS meta,
      vl.realizado
    FROM vendas_por_loja vl
    WHERE vl.loja NOT IN (SELECT loja FROM linhas_base)
      AND vl.realizado > 0
  ),
  linhas AS (
    SELECT * FROM linhas_base
    UNION ALL
    SELECT * FROM vendas_sem_meta
  ),
  seller_goals AS (
    SELECT
      st.loja,
      st.loja_nome,
      ps.name AS vendedor,
      g.goal_value::numeric AS meta,
      COALESCE(SUM(sa.total), 0)::numeric AS realizado,
      g.id AS goal_id,
      g.period,
      g.period_start,
      g.period_end
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
        (g.period = 'custom'
         AND g.period_start IS NOT NULL
         AND g.period_end IS NOT NULL
         AND g.period_start <= (d_end - 1)
         AND g.period_end >= d_start)
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
    'fonte_metas', 'pos_goals do PDV (oficial); monthly_goals apenas quando não houver meta no PDV para o canal',
    'path_metas_oficial', 'public.pos_goals -> public.pos_stores',
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
        'projecao_linear', ROUND(realizado * days_total::numeric / NULLIF(days_elapsed, 0), 2),
        'pct_meta', CASE WHEN meta > 0 THEN ROUND(realizado * 100 / meta, 1) ELSE NULL END,
        'falta', GREATEST(0, meta - realizado)
      ) ORDER BY
        CASE loja WHEN 'perola' THEN 1 WHEN 'centro' THEN 2 WHEN 'shopify' THEN 3 WHEN 'live' THEN 4 WHEN 'outras' THEN 5 ELSE 9 END,
        loja_nome)
      FROM linhas
    ), '[]'::jsonb),
    'metas_vendedoras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'loja', loja,
        'loja_nome', loja_nome,
        'vendedor', vendedor,
        'meta_goal_id', goal_id,
        'periodo_meta', period,
        'period_start', period_start,
        'period_end', period_end,
        'meta', meta,
        'realizado', realizado,
        'pct_meta', CASE WHEN meta > 0 THEN ROUND(realizado * 100 / meta, 1) ELSE NULL END,
        'falta', GREATEST(0, meta - realizado)
      ) ORDER BY loja_nome, vendedor)
      FROM seller_goals
    ), '[]'::jsonb),
    'total_consolidado', COALESCE((
      SELECT jsonb_build_object(
        'meta', SUM(meta),
        'realizado', SUM(realizado),
        'projecao_linear', ROUND(SUM(realizado) * days_total::numeric / NULLIF(days_elapsed, 0), 2),
        'pct_meta', CASE WHEN SUM(meta) > 0 THEN ROUND(SUM(realizado) * 100 / SUM(meta), 1) ELSE NULL END,
        'falta', GREATEST(0, SUM(meta) - SUM(realizado))
      )
      FROM linhas
      WHERE meta > 0
    ), jsonb_build_object('meta', 0, 'realizado', 0, 'projecao_linear', 0, 'pct_meta', NULL, 'falta', 0))
  ) INTO result;

  RETURN result;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_memory(p_mes_ref text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d_start date := CASE WHEN p_mes_ref IS NULL THEN date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date ELSE to_date(p_mes_ref || '-01', 'YYYY-MM-DD') END;
  d_end date := CASE WHEN p_mes_ref IS NULL THEN (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')::date ELSE (to_date(p_mes_ref || '-01', 'YYYY-MM-DD') + interval '1 month')::date END;
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'decisoes_ativas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'tipo', tipo, 'descricao', descricao, 'motivo', motivo,
        'contexto', contexto, 'created_at', created_at, 'revisitar_apos', revisitar_apos
      )) FROM (
        SELECT * FROM public.agent_decisions
        WHERE ativo = true AND (revisitar_apos IS NULL OR revisitar_apos > now())
        ORDER BY created_at DESC LIMIT 100
      ) d
    ), '[]'::jsonb),
    'calendario_mes', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT id, data, tipo_acao, titulo, descricao, publico_alvo_descricao,
               custo_estimado_brl, status, live_event_id
        FROM public.agent_calendar
        WHERE p_mes_ref IS NULL OR mes_ref = p_mes_ref
        ORDER BY data LIMIT 200
      ) x
    ), '[]'::jsonb),
    'metas_mes', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        WITH stores AS (
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
        ), ranked_goals AS (
          SELECT
            st.loja,
            st.loja_nome,
            g.id AS goal_id,
            g.goal_value::numeric AS meta_faturamento_brl,
            g.period,
            g.period_start,
            g.period_end,
            'pos_goals'::text AS fonte,
            ROW_NUMBER() OVER (
              PARTITION BY g.store_id
              ORDER BY
                CASE
                  WHEN g.period = 'custom'
                   AND g.period_start IS NOT NULL
                   AND g.period_end IS NOT NULL
                   AND g.period_start <= (d_end - 1)
                   AND g.period_end >= d_start
                  THEN 1
                  WHEN g.period = 'monthly' THEN 2
                  ELSE 9
                END,
                g.created_at DESC
            ) AS rn
          FROM public.pos_goals g
          JOIN stores st ON st.store_id = g.store_id
          WHERE g.is_active = true
            AND g.goal_type = 'revenue'
            AND g.seller_id IS NULL
            AND (
              (g.period = 'custom'
               AND g.period_start IS NOT NULL
               AND g.period_end IS NOT NULL
               AND g.period_start <= (d_end - 1)
               AND g.period_end >= d_start)
              OR g.period = 'monthly'
            )
        )
        SELECT loja, loja_nome, goal_id, meta_faturamento_brl, period, period_start, period_end, fonte
        FROM ranked_goals
        WHERE rn = 1
        UNION ALL
        SELECT
          mg.loja,
          CASE mg.loja
            WHEN 'perola' THEN 'Loja Perola'
            WHEN 'centro' THEN 'Loja Centro'
            WHEN 'shopify' THEN 'Tiny Shopify'
            WHEN 'live' THEN 'Live'
            WHEN 'total' THEN 'Total'
            ELSE mg.loja
          END AS loja_nome,
          mg.id AS goal_id,
          mg.meta_faturamento_brl,
          'monthly_goals'::text AS period,
          d_start AS period_start,
          d_end - 1 AS period_end,
          'monthly_goals'::text AS fonte
        FROM public.monthly_goals mg
        WHERE (p_mes_ref IS NULL OR mg.mes_ref = p_mes_ref)
          AND NOT EXISTS (SELECT 1 FROM ranked_goals rg WHERE rg.rn = 1 AND rg.loja = mg.loja)
        ORDER BY loja_nome
      ) x
    ), '[]'::jsonb),
    'fonte_metas_oficial', 'public.pos_goals (PDV) via public.pos_stores; monthly_goals só complementa canais sem meta no PDV'
  ) INTO result;
  RETURN result;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_sales_vs_goals(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_memory(text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_goals TO authenticated;
GRANT ALL ON public.pos_goals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_goals TO authenticated;
GRANT ALL ON public.monthly_goals TO service_role;