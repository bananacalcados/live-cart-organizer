
-- Add new RFM columns if not exist
ALTER TABLE public.zoppy_customers
  ADD COLUMN IF NOT EXISTS rfm_r_score integer,
  ADD COLUMN IF NOT EXISTS rfm_f_score integer,
  ADD COLUMN IF NOT EXISTS rfm_m_score integer,
  ADD COLUMN IF NOT EXISTS rfm_score integer,
  ADD COLUMN IF NOT EXISTS rfm_updated_at timestamptz;

-- Create/replace the calculate_rfm_scores function
CREATE OR REPLACE FUNCTION public.calculate_rfm_scores()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_updated int := 0;
  v_segments jsonb;
BEGIN
  -- Update all customers in zoppy_customers
  WITH scored AS (
    SELECT
      id,
      -- R score
      CASE
        WHEN last_purchase_at IS NULL THEN 0
        WHEN v_now - last_purchase_at <= interval '60 days' THEN 5
        WHEN v_now - last_purchase_at <= interval '120 days' THEN 4
        WHEN v_now - last_purchase_at <= interval '180 days' THEN 3
        WHEN v_now - last_purchase_at <= interval '365 days' THEN 2
        ELSE 1
      END AS r,
      -- F score
      CASE
        WHEN COALESCE(total_orders, 0) = 0 THEN 0
        WHEN total_orders = 1 THEN 1
        WHEN total_orders = 2 THEN 2
        WHEN total_orders = 3 THEN 3
        WHEN total_orders BETWEEN 4 AND 5 THEN 4
        ELSE 5
      END AS f,
      -- M score
      CASE
        WHEN COALESCE(total_spent, 0) = 0 THEN 0
        WHEN total_spent < 200 THEN 1
        WHEN total_spent < 400 THEN 2
        WHEN total_spent < 800 THEN 3
        WHEN total_spent < 1500 THEN 4
        ELSE 5
      END AS m,
      COALESCE(total_orders, 0) AS t_orders
    FROM zoppy_customers
  ),
  segmented AS (
    SELECT
      id, r, f, m,
      (r * 100 + f * 10 + m) AS composite,
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
  UPDATE zoppy_customers zc SET
    rfm_r_score = s.r,
    rfm_f_score = s.f,
    rfm_m_score = s.m,
    rfm_recency_score = s.r,
    rfm_frequency_score = s.f,
    rfm_monetary_score = s.m,
    rfm_score = s.composite,
    rfm_total_score = s.composite,
    rfm_segment = s.segment,
    rfm_updated_at = v_now,
    rfm_calculated_at = v_now
  FROM segmented s
  WHERE zc.id = s.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Build segment counts
  SELECT jsonb_object_agg(segment, cnt) INTO v_segments
  FROM (
    SELECT rfm_segment AS segment, count(*) AS cnt
    FROM zoppy_customers
    WHERE rfm_segment IS NOT NULL
    GROUP BY rfm_segment
    ORDER BY cnt DESC
  ) sub;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'segments', COALESCE(v_segments, '{}'::jsonb),
    'calculated_at', v_now
  );
END;
$$;
