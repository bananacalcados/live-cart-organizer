-- New metric model: legacy (frozen) + new POS sales (newer than legacy last purchase)
CREATE OR REPLACE FUNCTION public.recalc_customer_metrics(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lo int; v_ls numeric; v_lf timestamptz; v_ll timestamptz;
  v_orders int := 0; v_spent numeric := 0; v_first timestamptz; v_last timestamptz;
  v_total_orders int; v_total_spent numeric;
BEGIN
  SELECT COALESCE(legacy_orders,0), COALESCE(legacy_spent,0), legacy_first_purchase_at, legacy_last_purchase_at
    INTO v_lo, v_ls, v_lf, v_ll
  FROM public.customers_unified WHERE id = p_customer_id;

  SELECT count(*), COALESCE(sum(total),0),
         min(COALESCE(paid_at, created_at)), max(COALESCE(paid_at, created_at))
    INTO v_orders, v_spent, v_first, v_last
  FROM public.pos_sales
  WHERE customer_unified_id = p_customer_id
    AND status IN ('paid','completed','finalized','invoiced')
    AND (v_ll IS NULL OR COALESCE(paid_at, created_at) > v_ll);

  v_total_orders := v_lo + v_orders;
  v_total_spent  := v_ls + v_spent;

  UPDATE public.customers_unified SET
    total_orders = v_total_orders,
    total_spent = v_total_spent,
    avg_ticket = CASE WHEN v_total_orders > 0 THEN v_total_spent / v_total_orders ELSE 0 END,
    first_purchase_at = LEAST(v_lf, v_first),
    last_purchase_at = GREATEST(v_ll, v_last),
    updated_at = now()
  WHERE id = p_customer_id;
END;
$function$;

-- RFM: skip archived (merged duplicates)
CREATE OR REPLACE FUNCTION public.calculate_rfm_scores_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_updated int := 0;
  v_segments jsonb;
BEGIN
  WITH scored AS (
    SELECT id,
      CASE
        WHEN last_purchase_at IS NULL THEN 0
        WHEN v_now - last_purchase_at <= interval '60 days' THEN 5
        WHEN v_now - last_purchase_at <= interval '120 days' THEN 4
        WHEN v_now - last_purchase_at <= interval '180 days' THEN 3
        WHEN v_now - last_purchase_at <= interval '365 days' THEN 2
        ELSE 1
      END AS r,
      CASE
        WHEN COALESCE(total_orders, 0) = 0 THEN 0
        WHEN total_orders = 1 THEN 1
        WHEN total_orders = 2 THEN 2
        WHEN total_orders = 3 THEN 3
        WHEN total_orders BETWEEN 4 AND 5 THEN 4
        ELSE 5
      END AS f,
      CASE
        WHEN COALESCE(total_spent, 0) = 0 THEN 0
        WHEN total_spent < 200 THEN 1
        WHEN total_spent < 400 THEN 2
        WHEN total_spent < 800 THEN 3
        WHEN total_spent < 1500 THEN 4
        ELSE 5
      END AS m,
      COALESCE(total_orders, 0) AS t_orders
    FROM public.customers_unified
    WHERE NOT is_archived
  ),
  segmented AS (
    SELECT id, r, f, m, (r*100 + f*10 + m) AS composite,
      CASE
        WHEN r >= 4 AND f >= 4 AND m >= 4 THEN 'champions'
        WHEN r <= 2 AND f >= 4 AND m >= 4 THEN 'cant_lose'
        WHEN f >= 4 AND m >= 3 THEN 'loyal_customers'
        WHEN r = 3 AND f >= 3 AND m >= 3 THEN 'at_risk'
        WHEN r >= 4 AND f = 2 AND m >= 2 THEN 'promising'
        WHEN r >= 4 AND f = 1 THEN 'new_customers'
        WHEN r = 2 AND f <= 3 AND m <= 3 THEN 'hibernating'
        WHEN r = 1 THEN 'lost'
        WHEN t_orders = 0 THEN 'leads'
        ELSE 'others'
      END AS segment
    FROM scored
  )
  UPDATE public.customers_unified cu SET
    rfm_r = s.r, rfm_f = s.f, rfm_m = s.m,
    rfm_total = s.composite, rfm_segment = s.segment, updated_at = now()
  FROM segmented s
  WHERE cu.id = s.id
    AND (cu.rfm_r IS DISTINCT FROM s.r OR cu.rfm_f IS DISTINCT FROM s.f
      OR cu.rfm_m IS DISTINCT FROM s.m OR cu.rfm_total IS DISTINCT FROM s.composite
      OR cu.rfm_segment IS DISTINCT FROM s.segment);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT jsonb_object_agg(segment, cnt) INTO v_segments
  FROM (SELECT rfm_segment AS segment, count(*) AS cnt
        FROM public.customers_unified WHERE rfm_segment IS NOT NULL AND NOT is_archived
        GROUP BY rfm_segment ORDER BY cnt DESC) sub;

  RETURN jsonb_build_object('updated', v_updated, 'segments', COALESCE(v_segments,'{}'::jsonb), 'calculated_at', v_now);
END;
$function$;