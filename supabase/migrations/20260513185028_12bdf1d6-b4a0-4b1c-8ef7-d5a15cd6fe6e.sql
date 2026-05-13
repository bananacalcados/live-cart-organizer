CREATE OR REPLACE FUNCTION public.backfill_master_costs_from_pos()
RETURNS TABLE(masters_updated INT, variants_updated INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m_count INT := 0;
  v_count INT := 0;
  tmp INT := 0;
BEGIN
  -- Variants: pass 1 by tiny_variant_id
  UPDATE product_variants pv
  SET cost_price_override = sub.avg_cost, updated_at = now()
  FROM (
    SELECT pv.id, ROUND(AVG(NULLIF(pp.cost_price,0))::numeric, 2) AS avg_cost
    FROM product_variants pv
    JOIN pos_products pp ON pp.tiny_id::text = pv.tiny_variant_id::text
    WHERE COALESCE(pv.cost_price_override,0) = 0 AND pv.tiny_variant_id IS NOT NULL
    GROUP BY pv.id
    HAVING AVG(NULLIF(pp.cost_price,0)) > 0
  ) sub
  WHERE pv.id = sub.id;
  GET DIAGNOSTICS tmp = ROW_COUNT; v_count := v_count + tmp;

  -- Variants: pass 2 by SKU
  UPDATE product_variants pv
  SET cost_price_override = sub.avg_cost, updated_at = now()
  FROM (
    SELECT pv.id, ROUND(AVG(NULLIF(pp.cost_price,0))::numeric, 2) AS avg_cost
    FROM product_variants pv
    JOIN pos_products pp ON pp.sku = pv.sku
    WHERE COALESCE(pv.cost_price_override,0) = 0
    GROUP BY pv.id
    HAVING AVG(NULLIF(pp.cost_price,0)) > 0
  ) sub
  WHERE pv.id = sub.id;
  GET DIAGNOSTICS tmp = ROW_COUNT; v_count := v_count + tmp;

  -- Variants: pass 3 by GTIN/barcode
  UPDATE product_variants pv
  SET cost_price_override = sub.avg_cost, updated_at = now()
  FROM (
    SELECT pv.id, ROUND(AVG(NULLIF(pp.cost_price,0))::numeric, 2) AS avg_cost
    FROM product_variants pv
    JOIN pos_products pp ON pp.barcode = pv.gtin
    WHERE COALESCE(pv.cost_price_override,0) = 0 AND pv.gtin IS NOT NULL
    GROUP BY pv.id
    HAVING AVG(NULLIF(pp.cost_price,0)) > 0
  ) sub
  WHERE pv.id = sub.id;
  GET DIAGNOSTICS tmp = ROW_COUNT; v_count := v_count + tmp;

  -- Master: pass 4 by master.tiny_product_id
  UPDATE products_master pm
  SET cost_price = sub.avg_cost, updated_at = now()
  FROM (
    SELECT pm.id, ROUND(AVG(NULLIF(pp.cost_price,0))::numeric, 2) AS avg_cost
    FROM products_master pm
    JOIN pos_products pp ON pp.tiny_id::text = pm.tiny_product_id::text
    WHERE COALESCE(pm.cost_price,0) = 0 AND pm.tiny_product_id IS NOT NULL
    GROUP BY pm.id
    HAVING AVG(NULLIF(pp.cost_price,0)) > 0
  ) sub
  WHERE pm.id = sub.id;
  GET DIAGNOSTICS tmp = ROW_COUNT; m_count := m_count + tmp;

  -- Master: pass 5 from variants average
  UPDATE products_master pm
  SET cost_price = sub.avg_cost, updated_at = now()
  FROM (
    SELECT pv.master_id AS id, ROUND(AVG(NULLIF(pv.cost_price_override,0))::numeric, 2) AS avg_cost
    FROM product_variants pv
    WHERE pv.cost_price_override > 0
    GROUP BY pv.master_id
    HAVING AVG(NULLIF(pv.cost_price_override,0)) > 0
  ) sub
  WHERE pm.id = sub.id AND COALESCE(pm.cost_price,0) = 0;
  GET DIAGNOSTICS tmp = ROW_COUNT; m_count := m_count + tmp;

  RETURN QUERY SELECT m_count, v_count;
END;
$$;