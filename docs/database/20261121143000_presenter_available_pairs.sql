-- Display-only stock: no writes, triggers, reservations or selling restrictions.
CREATE OR REPLACE FUNCTION public.live_presenter_available_pairs(
  p_event_id uuid, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0
) RETURNS TABLE(code text, sizes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')
    OR public.has_module_access(auth.uid(), 'events')) THEN
    RAISE EXCEPTION 'Acesso restrito à equipe da live' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH prepared AS MATERIALIZED (
    SELECT lp.code, c.master_id, c.color
    FROM public.live_presenter_products lp
    JOIN public.product_color_codes c ON c.code = lp.code
    WHERE lp.event_id = p_event_id
    ORDER BY lp.created_at, lp.code
    LIMIT LEAST(200, GREATEST(1, COALESCE(p_limit, 200)))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ), variants AS MATERIALIZED (
    SELECT p.code, v.id AS variant_id, v.size, v.gtin, v.sku
    FROM prepared p JOIN public.product_variants v ON v.master_id = p.master_id
      AND lower(trim(coalesce(v.color, ''))) = lower(trim(coalesce(p.color, '')))
    WHERE v.is_active AND v.size IS NOT NULL
  ), real_stores AS MATERIALIZED (
    SELECT s.id FROM public.pos_stores s WHERE s.is_active AND NOT s.is_simulation
  ), barcode_products AS MATERIALIZED (
    SELECT v.code, v.variant_id, v.size, pp.id AS product_id, pp.store_id,
      pp.barcode, pp.sku, pp.stock
    FROM variants v CROSS JOIN real_stores s
    JOIN public.pos_products pp ON pp.store_id = s.id AND pp.barcode = v.gtin
    WHERE v.gtin IS NOT NULL AND v.gtin <> '' AND pp.barcode <> ''
  ), missing_variants AS MATERIALIZED (
    SELECT v.* FROM variants v
    LEFT JOIN (SELECT DISTINCT bp.variant_id FROM barcode_products bp) found
      ON found.variant_id = v.variant_id
    WHERE found.variant_id IS NULL
  ), matched_products AS MATERIALIZED (
    SELECT * FROM barcode_products
    UNION ALL
    -- Legacy variants without a matching GTIN retain their exact SKU identity.
    SELECT v.code, v.variant_id, v.size, pp.id, pp.store_id, pp.barcode, pp.sku, pp.stock
    FROM missing_variants v CROSS JOIN real_stores s
    JOIN public.pos_products pp ON pp.store_id = s.id AND pp.sku = v.sku
    WHERE v.sku IS NOT NULL AND v.sku <> ''
  ), balances AS MATERIALIZED (
    SELECT mp.variant_id, mp.store_id, max(b.balanced_at) AS balanced_at
    FROM matched_products mp
    CROSS JOIN LATERAL (
      SELECT max(a.created_at) AS balanced_at FROM public.pos_stock_adjustments a
      WHERE a.product_id = mp.product_id AND a.store_id = mp.store_id
        AND a.movement_type = 'balanco'
    ) b
    GROUP BY mp.variant_id, mp.store_id
    HAVING max(b.balanced_at) IS NOT NULL
  ), eligible_sales AS MATERIALIZED (
    SELECT DISTINCT mp.variant_id, a.sale_id, mp.barcode, mp.sku
    FROM matched_products mp
    JOIN balances b ON b.variant_id = mp.variant_id AND b.store_id = mp.store_id
    JOIN public.pos_stock_adjustments a ON a.product_id = mp.product_id
      AND a.store_id = b.store_id AND a.sale_id IS NOT NULL
      AND a.sale_event = 'sale' AND a.created_at < b.balanced_at
    JOIN public.pos_sales s ON s.id = a.sale_id
      AND s.status IN ('paid', 'completed', 'conditional')
      AND coalesce(s.status_cancelamento::text, '') NOT IN ('cancelado', 'cancelled')
      AND coalesce(s.expedition_stage, '') <> 'concluido'
      AND s.created_at < b.balanced_at
  ), pending_items AS MATERIALIZED (
    -- DISTINCT item prevents multiple adjustments/balances counting the same pair twice.
    SELECT DISTINCT es.variant_id, i.id, i.quantity
    FROM eligible_sales es JOIN public.pos_sale_items i ON i.sale_id = es.sale_id AND i.quantity > 0
      AND ((es.barcode <> '' AND i.barcode = es.barcode)
        OR (es.sku <> '' AND i.sku = es.sku))
  ), totals AS (
    SELECT mp.variant_id, sum(coalesce(mp.stock, 0)) AS total_stock
    FROM matched_products mp GROUP BY mp.variant_id
  ), pending AS (
    SELECT i.variant_id, sum(i.quantity) AS pending_pairs
    FROM pending_items i GROUP BY i.variant_id
  )
  SELECT v.code, jsonb_agg(jsonb_build_object(
    'size', v.size, 'total_stock', coalesce(t.total_stock, 0),
    'pending_pairs', coalesce(p.pending_pairs, 0),
    'available_pairs', greatest(0, coalesce(t.total_stock, 0) - coalesce(p.pending_pairs, 0))
  ) ORDER BY v.size) AS sizes
  FROM variants v LEFT JOIN totals t ON t.variant_id = v.variant_id
    LEFT JOIN pending p ON p.variant_id = v.variant_id
  GROUP BY v.code;
END;
$function$;
REVOKE ALL ON FUNCTION public.live_presenter_available_pairs(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_presenter_available_pairs(uuid, integer, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.live_presenter_available_pairs(uuid, integer, integer) IS
  'Read-only presenter display: shared real-store stock less unshipped sale items restored by a later balance in the actual deduction store. Never restricts sales.';