CREATE OR REPLACE FUNCTION public.backfill_master_costs_from_pos()
RETURNS TABLE(masters_updated INT, variants_updated INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m_count INT := 0;
  v_count INT := 0;
BEGIN
  -- 1) Backfill product_variants.cost_price_override (zeradas) a partir do pos_products correspondente
  WITH variant_costs AS (
    SELECT pv.id AS variant_id,
           AVG(NULLIF(pp.cost_price, 0)) AS avg_cost
    FROM product_variants pv
    LEFT JOIN pos_products pp ON
      pp.tiny_id::text = pv.tiny_variant_id::text
      OR pp.sku = pv.sku
      OR (pv.gtin IS NOT NULL AND pp.barcode = pv.gtin)
    WHERE COALESCE(pv.cost_price_override, 0) = 0
    GROUP BY pv.id
    HAVING AVG(NULLIF(pp.cost_price, 0)) > 0
  )
  UPDATE product_variants pv
  SET cost_price_override = ROUND(vc.avg_cost::numeric, 2),
      updated_at = now()
  FROM variant_costs vc
  WHERE pv.id = vc.variant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 2) Backfill products_master.cost_price (zerados) a partir do pos_products
  WITH master_costs AS (
    SELECT pm.id AS master_id,
           AVG(NULLIF(pp.cost_price, 0)) AS avg_cost
    FROM products_master pm
    LEFT JOIN product_variants pv ON pv.master_id = pm.id
    LEFT JOIN pos_products pp ON
      pp.tiny_id::text = pm.tiny_product_id::text
      OR pp.tiny_id::text = pv.tiny_variant_id::text
      OR pp.sku = pv.sku
      OR (pv.gtin IS NOT NULL AND pp.barcode = pv.gtin)
    WHERE COALESCE(pm.cost_price, 0) = 0
    GROUP BY pm.id
    HAVING AVG(NULLIF(pp.cost_price, 0)) > 0
  )
  UPDATE products_master pm
  SET cost_price = ROUND(mc.avg_cost::numeric, 2),
      updated_at = now()
  FROM master_costs mc
  WHERE pm.id = mc.master_id;
  GET DIAGNOSTICS m_count = ROW_COUNT;

  RETURN QUERY SELECT m_count, v_count;
END;
$$;