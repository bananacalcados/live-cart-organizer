
-- =====================================================================
-- Curva ABC — Produtos (por parent_sku / master)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_abc_curve_products(
  p_days int DEFAULT 60,
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
  parent_sku text,
  master_name text,
  category text,
  brand text,
  revenue numeric,
  qty bigint,
  sales_count bigint,
  rank bigint,
  revenue_pct numeric,
  cum_pct numeric,
  abc_class char(1)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      pp.parent_sku,
      psi.quantity::bigint AS qty,
      psi.total_price::numeric AS revenue,
      psi.sale_id
    FROM pos_sale_items psi
    JOIN pos_sales ps ON ps.id = psi.sale_id
    JOIN pos_products pp
      ON (pp.barcode IS NOT NULL AND pp.barcode = psi.barcode)
      OR (pp.sku IS NOT NULL AND pp.sku = psi.sku)
    WHERE ps.status IN ('completed','paid')
      AND ps.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
      AND (p_store_id IS NULL OR ps.store_id = p_store_id)
      AND pp.parent_sku IS NOT NULL
      AND pp.parent_sku <> ''
  ),
  agg AS (
    SELECT
      b.parent_sku,
      SUM(b.revenue) AS revenue,
      SUM(b.qty)     AS qty,
      COUNT(DISTINCT b.sale_id) AS sales_count
    FROM base b
    GROUP BY b.parent_sku
  ),
  ranked AS (
    SELECT
      a.parent_sku,
      pm.name        AS master_name,
      pm.category    AS category,
      pm.brand       AS brand,
      a.revenue,
      a.qty,
      a.sales_count,
      ROW_NUMBER() OVER (ORDER BY a.revenue DESC) AS rank,
      SUM(a.revenue) OVER () AS total_rev
    FROM agg a
    LEFT JOIN products_master pm ON pm.sku_root = a.parent_sku
  ),
  scored AS (
    SELECT
      r.*,
      CASE WHEN total_rev > 0 THEN (r.revenue / total_rev) * 100 ELSE 0 END AS revenue_pct,
      CASE WHEN total_rev > 0
           THEN (SUM(r.revenue) OVER (ORDER BY r.revenue DESC, r.parent_sku
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / total_rev) * 100
           ELSE 0 END AS cum_pct
    FROM ranked r
  )
  SELECT
    s.parent_sku,
    s.master_name,
    s.category,
    s.brand,
    ROUND(s.revenue::numeric, 2) AS revenue,
    s.qty,
    s.sales_count,
    s.rank,
    ROUND(s.revenue_pct::numeric, 2) AS revenue_pct,
    ROUND(s.cum_pct::numeric, 2)     AS cum_pct,
    CASE
      WHEN s.cum_pct <= 80 THEN 'A'
      WHEN s.cum_pct <= 95 THEN 'B'
      ELSE 'C'
    END::char(1) AS abc_class
  FROM scored s
  ORDER BY s.rank;
$$;

GRANT EXECUTE ON FUNCTION public.get_abc_curve_products(int, uuid) TO authenticated, service_role;

-- =====================================================================
-- Curva ABC — Tamanhos (peso da grade)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_abc_curve_sizes(
  p_days int DEFAULT 60,
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
  size_label text,
  revenue numeric,
  qty bigint,
  rank bigint,
  revenue_pct numeric,
  cum_pct numeric,
  abc_class char(1)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(psi.size), ''), NULLIF(TRIM(pp.size), '')) AS size_label,
      psi.quantity::bigint AS qty,
      psi.total_price::numeric AS revenue
    FROM pos_sale_items psi
    JOIN pos_sales ps ON ps.id = psi.sale_id
    LEFT JOIN pos_products pp
      ON (pp.barcode IS NOT NULL AND pp.barcode = psi.barcode)
      OR (pp.sku IS NOT NULL AND pp.sku = psi.sku)
    WHERE ps.status IN ('completed','paid')
      AND ps.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
      AND (p_store_id IS NULL OR ps.store_id = p_store_id)
  ),
  agg AS (
    SELECT b.size_label, SUM(b.revenue) AS revenue, SUM(b.qty) AS qty
    FROM base b
    WHERE b.size_label IS NOT NULL
    GROUP BY b.size_label
  ),
  ranked AS (
    SELECT
      a.size_label,
      a.revenue,
      a.qty,
      ROW_NUMBER() OVER (ORDER BY a.revenue DESC) AS rank,
      SUM(a.revenue) OVER () AS total_rev
    FROM agg a
  ),
  scored AS (
    SELECT
      r.*,
      CASE WHEN total_rev > 0 THEN (r.revenue / total_rev) * 100 ELSE 0 END AS revenue_pct,
      CASE WHEN total_rev > 0
           THEN (SUM(r.revenue) OVER (ORDER BY r.revenue DESC, r.size_label
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / total_rev) * 100
           ELSE 0 END AS cum_pct
    FROM ranked r
  )
  SELECT
    s.size_label,
    ROUND(s.revenue::numeric, 2) AS revenue,
    s.qty,
    s.rank,
    ROUND(s.revenue_pct::numeric, 2) AS revenue_pct,
    ROUND(s.cum_pct::numeric, 2) AS cum_pct,
    CASE
      WHEN s.cum_pct <= 80 THEN 'A'
      WHEN s.cum_pct <= 95 THEN 'B'
      ELSE 'C'
    END::char(1) AS abc_class
  FROM scored s
  ORDER BY s.rank;
$$;

GRANT EXECUTE ON FUNCTION public.get_abc_curve_sizes(int, uuid) TO authenticated, service_role;
