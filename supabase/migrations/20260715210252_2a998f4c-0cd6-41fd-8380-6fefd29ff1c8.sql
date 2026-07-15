
CREATE OR REPLACE FUNCTION public.get_sales_vs_goals(p_mes_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d_start DATE := to_date(p_mes_ref || '-01','YYYY-MM-DD');
  d_end   DATE := (d_start + interval '1 month')::date;
  today   DATE := CURRENT_DATE;
  days_elapsed INT := GREATEST(1, LEAST(today, d_end - 1) - d_start + 1);
  days_total INT := d_end - d_start;
  result JSONB;
BEGIN
  WITH
  store_map AS (
    SELECT id AS store_id,
      CASE
        WHEN LOWER(name) LIKE '%perola%'  THEN 'perola'
        WHEN LOWER(name) LIKE '%centro%'  THEN 'centro'
        WHEN LOWER(name) LIKE '%shopify%' THEN 'shopify'
        ELSE 'total'
      END AS loja
    FROM pos_stores
    WHERE is_active = true AND COALESCE(is_simulation,false) = false
  ),
  vendas_raw AS (
    SELECT
      CASE
        WHEN s.sale_type IN ('live','live_shopping') THEN 'live'
        ELSE COALESCE(sm.loja, 'total')
      END AS loja,
      s.total
    FROM pos_sales s
    LEFT JOIN store_map sm ON sm.store_id = s.store_id
    WHERE s.status IN ('completed','pending_sync','paid')
      AND COALESCE(s.revenue_attribution,'') <> 'site_pickup_only'
      AND (
        (s.paid_at IS NOT NULL AND s.paid_at >= d_start AND s.paid_at < d_end)
        OR (s.paid_at IS NULL AND s.created_at >= d_start AND s.created_at < d_end)
      )
  ),
  vendas AS (
    SELECT loja, SUM(total)::numeric AS faturado
    FROM vendas_raw GROUP BY loja
  ),
  -- Metas do PDV (fonte real): revenue por loja, seller NULL, mensal ou custom cobrindo o mês
  metas_pdv AS (
    SELECT sm.loja, SUM(g.goal_value)::numeric AS meta
    FROM pos_goals g
    JOIN store_map sm ON sm.store_id = g.store_id
    WHERE g.is_active = true
      AND g.goal_type = 'revenue'
      AND g.seller_id IS NULL
      AND (
        g.period = 'monthly'
        OR (g.period = 'custom'
            AND g.period_start IS NOT NULL AND g.period_end IS NOT NULL
            AND g.period_start <= (d_end - 1) AND g.period_end >= d_start)
      )
    GROUP BY sm.loja
  ),
  -- Metas manuais (monthly_goals): live/shopify/total/overrides
  metas_manual AS (
    SELECT loja, meta_faturamento_brl::numeric AS meta
    FROM monthly_goals WHERE mes_ref = p_mes_ref
  ),
  metas AS (
    SELECT loja, SUM(meta)::numeric AS meta FROM (
      SELECT loja, meta FROM metas_pdv
      UNION ALL
      SELECT loja, meta FROM metas_manual
    ) x GROUP BY loja
  ),
  lojas AS (
    SELECT loja FROM metas
    UNION SELECT loja FROM vendas
  )
  SELECT jsonb_build_object(
    'mes_ref', p_mes_ref,
    'dias_decorridos', days_elapsed,
    'dias_totais', days_total,
    'fonte_metas', 'pos_goals + monthly_goals',
    'por_loja', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'loja', l.loja,
        'meta', COALESCE(m.meta, 0),
        'realizado', COALESCE(v.faturado, 0),
        'projecao_linear', ROUND(COALESCE(v.faturado,0) * days_total::numeric / NULLIF(days_elapsed,0), 2),
        'pct_meta', CASE WHEN COALESCE(m.meta,0) > 0
                         THEN ROUND(COALESCE(v.faturado,0)*100/m.meta, 1)
                         ELSE NULL END,
        'falta', GREATEST(0, COALESCE(m.meta,0) - COALESCE(v.faturado,0))
      ) ORDER BY l.loja)
      FROM lojas l
      LEFT JOIN metas m  ON m.loja  = l.loja
      LEFT JOIN vendas v ON v.loja = l.loja
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $function$;
