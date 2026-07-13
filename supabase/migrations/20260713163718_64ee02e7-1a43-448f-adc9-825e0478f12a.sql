CREATE OR REPLACE FUNCTION public.get_checkout_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH order_row AS (
    SELECT o.*
    FROM orders o
    WHERE o.id = p_order_id
  ), order_totals AS (
    SELECT
      o.id,
      COALESCE(SUM(
        COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1)
      ), 0) AS subtotal
    FROM order_row o
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(o.products, '[]'::jsonb)) item ON true
    GROUP BY o.id
  ), base_config AS (
    SELECT
      COALESCE((value->>'max_installments')::int, 12) AS max_installments,
      COALESCE((value->>'interest_free_installments')::int, 6) AS interest_free_installments,
      COALESCE((value->>'monthly_interest_rate')::numeric, 2.49) AS monthly_interest_rate
    FROM app_settings
    WHERE key = 'installment_config'
    LIMIT 1
  ), effective AS (
    SELECT
      o.*,
      e.installment_min_value,
      e.installment_max,
      COALESCE(b.max_installments, 12) AS base_max_installments,
      COALESCE(b.interest_free_installments, 6) AS base_interest_free_installments,
      COALESCE(b.monthly_interest_rate, 2.49) AS base_monthly_interest_rate,
      CASE
        WHEN e.installment_max IS NOT NULL
          AND e.installment_max > 0
          AND (ot.subtotal
            - CASE
                WHEN o.discount_type = 'percentage' THEN ot.subtotal * (COALESCE(o.discount_value, 0) / 100)
                ELSE COALESCE(o.discount_value, 0)
              END
            + CASE WHEN COALESCE(o.free_shipping, false) THEN 0 ELSE COALESCE(o.shipping_cost, 0) END
          ) >= COALESCE(e.installment_min_value, 0)
        THEN GREATEST(COALESCE(b.max_installments, 12), e.installment_max)
        ELSE COALESCE(b.max_installments, 12)
      END AS effective_max_installments,
      CASE
        WHEN e.installment_max IS NOT NULL
          AND e.installment_max > 0
          AND (ot.subtotal
            - CASE
                WHEN o.discount_type = 'percentage' THEN ot.subtotal * (COALESCE(o.discount_value, 0) / 100)
                ELSE COALESCE(o.discount_value, 0)
              END
            + CASE WHEN COALESCE(o.free_shipping, false) THEN 0 ELSE COALESCE(o.shipping_cost, 0) END
          ) >= COALESCE(e.installment_min_value, 0)
        THEN GREATEST(COALESCE(b.interest_free_installments, 6), e.installment_max)
        ELSE COALESCE(b.interest_free_installments, 6)
      END AS effective_interest_free_installments
    FROM order_row o
    LEFT JOIN order_totals ot ON ot.id = o.id
    LEFT JOIN events e ON e.id = o.event_id
    LEFT JOIN base_config b ON true
  )
  SELECT to_jsonb(eff.*)
    - 'base_max_installments'
    - 'base_interest_free_installments'
    - 'base_monthly_interest_rate'
    - 'effective_max_installments'
    - 'effective_interest_free_installments'
    || jsonb_build_object(
      'customer',
      (SELECT jsonb_build_object('id', c.id, 'instagram_handle', c.instagram_handle, 'whatsapp', c.whatsapp)
         FROM customers c WHERE c.id = eff.customer_id),
      'event_installment_min_value', eff.installment_min_value,
      'event_installment_max', eff.installment_max,
      'checkout_installment_config', jsonb_build_object(
        'max_installments', eff.effective_max_installments,
        'interest_free_installments', eff.effective_interest_free_installments,
        'monthly_interest_rate', eff.base_monthly_interest_rate
      )
    )
  FROM effective eff;
$$;

REVOKE ALL ON FUNCTION public.get_checkout_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_checkout_order(uuid) TO anon, authenticated;