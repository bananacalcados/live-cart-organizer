
CREATE OR REPLACE FUNCTION public.calculate_inventory_health(
  p_horizon_days int DEFAULT 60,
  p_store_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH
  prod AS (
    SELECT pp.parent_sku, NULLIF(TRIM(pp.size),'') AS size_label,
           pp.stock, pp.price, pp.cost_price, pp.store_id, pp.barcode, pp.sku, pp.created_at
    FROM pos_products pp
    JOIN pos_stores st ON st.id = pp.store_id AND st.is_active AND NOT st.is_simulation
    WHERE (p_store_id IS NULL OR pp.store_id = p_store_id)
      AND pp.parent_sku IS NOT NULL AND pp.parent_sku <> ''
  ),
  abc_p AS ( SELECT * FROM get_abc_curve_products(p_horizon_days, p_store_id) ),
  abc_s AS ( SELECT * FROM get_abc_curve_sizes(p_horizon_days, p_store_id) ),
  expected AS (
    SELECT parent_sku, COUNT(DISTINCT size_label) AS n
    FROM prod WHERE size_label IS NOT NULL GROUP BY parent_sku
  ),
  present AS (
    SELECT parent_sku, COUNT(DISTINCT size_label) FILTER (WHERE stock > 0) AS n
    FROM prod WHERE size_label IS NOT NULL GROUP BY parent_sku
  ),
  coverage AS (
    SELECT e.parent_sku, e.n AS expected_sizes, COALESCE(pr.n, 0) AS present_sizes,
      CASE WHEN e.n > 0 THEN COALESCE(pr.n,0)::numeric / e.n ELSE 0 END AS ratio
    FROM expected e LEFT JOIN present pr USING (parent_sku)
  ),
  p1 AS (
    SELECT COALESCE(SUM(c.ratio * a.revenue) / NULLIF(SUM(a.revenue),0), 0) * 100 AS score
    FROM abc_p a JOIN coverage c USING (parent_sku) WHERE a.abc_class = 'A'
  ),
  p2 AS (
    SELECT COALESCE(SUM(c.ratio * a.revenue) / NULLIF(SUM(a.revenue),0), 0) * 100 AS score
    FROM abc_p a JOIN coverage c USING (parent_sku) WHERE a.abc_class = 'B'
  ),
  size_expected AS (
    SELECT size_label, COUNT(*) AS n_expected FROM prod WHERE size_label IS NOT NULL GROUP BY size_label
  ),
  size_present AS (
    SELECT size_label, COUNT(*) FILTER (WHERE stock > 0) AS n_present FROM prod WHERE size_label IS NOT NULL GROUP BY size_label
  ),
  p3 AS (
    SELECT COALESCE(SUM((COALESCE(sp.n_present,0)::numeric / NULLIF(se.n_expected,0)) * s.revenue_pct)
                    / NULLIF(SUM(s.revenue_pct),0), 0) * 100 AS score
    FROM abc_s s
    JOIN size_expected se ON se.size_label = s.size_label
    LEFT JOIN size_present sp ON sp.size_label = s.size_label
  ),
  fresh AS (
    SELECT DISTINCT pp.parent_sku
    FROM pos_products pp
    WHERE pp.parent_sku IS NOT NULL AND pp.parent_sku <> ''
      AND (p_store_id IS NULL OR pp.store_id = p_store_id)
      AND (
        pp.created_at >= now() - interval '60 days'
        OR EXISTS (
          SELECT 1 FROM pos_sale_items psi JOIN pos_sales ps ON ps.id = psi.sale_id
          WHERE ((psi.barcode IS NOT NULL AND psi.barcode = pp.barcode)
                 OR (psi.sku IS NOT NULL AND psi.sku = pp.sku))
            AND ps.created_at >= now() - interval '60 days'
            AND ps.status IN ('completed','paid')
            AND (p_store_id IS NULL OR ps.store_id = p_store_id)
        )
      )
  ),
  all_parents AS ( SELECT DISTINCT parent_sku FROM prod ),
  p4 AS (
    SELECT CASE WHEN COUNT(*) > 0
                THEN (COUNT(*) FILTER (WHERE parent_sku IN (SELECT parent_sku FROM fresh)))::numeric * 100 / COUNT(*)
                ELSE 50 END AS score
    FROM all_parents
  ),
  stock_totals AS ( SELECT COALESCE(SUM(stock),0) AS total_stock FROM prod WHERE stock > 0 ),
  sales_30d AS (
    SELECT COALESCE(SUM(psi.quantity),0) AS qty
    FROM pos_sale_items psi JOIN pos_sales ps ON ps.id = psi.sale_id
    WHERE ps.status IN ('completed','paid')
      AND ps.created_at >= now() - interval '30 days'
      AND (p_store_id IS NULL OR ps.store_id = p_store_id)
  ),
  p5 AS (
    -- Sell-through: qty vendida em 30d / estoque atual.
    -- ratio 0.25 (25%/mês) => 100 pts (linear, cap 100)
    SELECT LEAST(100, GREATEST(0,
      (COALESCE((SELECT qty FROM sales_30d),0)::numeric
       / NULLIF((SELECT total_stock FROM stock_totals),0)) * 400
    )) AS score
  ),
  rupture AS (
    SELECT COUNT(*) AS ruptured
    FROM abc_p a JOIN coverage c USING (parent_sku)
    WHERE a.abc_class IN ('A','B') AND c.ratio < 1
  ),
  ab_total AS ( SELECT COUNT(*) AS n FROM abc_p WHERE abc_class IN ('A','B') ),
  p6 AS (
    SELECT CASE WHEN (SELECT n FROM ab_total) > 0
                THEN GREATEST(0, 100 - ((SELECT ruptured FROM rupture)::numeric * 100 / (SELECT n FROM ab_total)))
                ELSE 50 END AS score
  ),
  forecast AS (
    SELECT COALESCE(SUM(psi.total_price),0) * (30.0 / GREATEST(p_horizon_days,1)) AS projected_month
    FROM pos_sale_items psi JOIN pos_sales ps ON ps.id = psi.sale_id
    WHERE ps.status IN ('completed','paid')
      AND ps.created_at >= now() - make_interval(days => p_horizon_days)
      AND (p_store_id IS NULL OR ps.store_id = p_store_id)
  ),
  stock_value AS (
    SELECT COALESCE(SUM(stock * price), 0) AS v FROM prod WHERE stock > 0
  )
  SELECT jsonb_build_object(
    'horizon_days', p_horizon_days,
    'store_id', p_store_id,
    'pillars', jsonb_build_array(
      jsonb_build_object('key','curve_a','label','Cobertura Curva A','weight',30,'score', ROUND(COALESCE((SELECT score FROM p1),0)::numeric,1)),
      jsonb_build_object('key','curve_b','label','Cobertura Curva B','weight',12,'score', ROUND(COALESCE((SELECT score FROM p2),0)::numeric,1)),
      jsonb_build_object('key','size_weighted','label','Cobertura por tamanho','weight',20,'score', ROUND(COALESCE((SELECT score FROM p3),0)::numeric,1)),
      jsonb_build_object('key','freshness','label','Frescor / idade','weight',10,'score', ROUND(COALESCE((SELECT score FROM p4),0)::numeric,1)),
      jsonb_build_object('key','turnover','label','Giro (sell-through)','weight',18,'score', ROUND(COALESCE((SELECT score FROM p5),0)::numeric,1)),
      jsonb_build_object('key','stockout','label','Ruptura recente','weight',10,'score', ROUND(COALESCE((SELECT score FROM p6),0)::numeric,1))
    ),
    'overall', ROUND((
      COALESCE((SELECT score FROM p1),0)*0.30 +
      COALESCE((SELECT score FROM p2),0)*0.12 +
      COALESCE((SELECT score FROM p3),0)*0.20 +
      COALESCE((SELECT score FROM p4),0)*0.10 +
      COALESCE((SELECT score FROM p5),0)*0.18 +
      COALESCE((SELECT score FROM p6),0)*0.10
    )::numeric, 1),
    'forecast_month_brl', ROUND(COALESCE((SELECT projected_month FROM forecast),0)::numeric, 2),
    'total_stock_value', ROUND(COALESCE((SELECT v FROM stock_value),0)::numeric, 2),
    'abc_summary', jsonb_build_object(
      'a_count', (SELECT COUNT(*) FROM abc_p WHERE abc_class='A'),
      'b_count', (SELECT COUNT(*) FROM abc_p WHERE abc_class='B'),
      'c_count', (SELECT COUNT(*) FROM abc_p WHERE abc_class='C')
    )
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.calculate_inventory_health(int, uuid) TO authenticated, service_role;
