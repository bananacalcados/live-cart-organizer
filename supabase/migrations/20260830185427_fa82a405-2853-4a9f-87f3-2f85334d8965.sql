CREATE OR REPLACE FUNCTION public.event_inner_dashboard(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total_orders int := 0;
  v_paid_orders int := 0;
  v_revenue numeric := 0;
  v_avg_ticket numeric := 0;
  v_crossell_added int := 0;
  v_crossell_converted int := 0;
  v_leads_total int := 0;
  v_leads_lp int := 0;
  v_leads_typebot int := 0;
  v_leads_converted int := 0;
  v_conversion numeric := 0;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])),
    COALESCE(SUM(public.bc_order_total(o.products, o.discount_type, o.discount_value))
      FILTER (WHERE o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed'])), 0)
  INTO v_total_orders, v_paid_orders, v_revenue
  FROM public.orders o
  WHERE o.event_id = p_event_id
    AND o.stage <> 'cancelled';

  IF v_paid_orders > 0 THEN
    v_avg_ticket := v_revenue / v_paid_orders;
  END IF;

  SELECT
    COALESCE(SUM(ci.qty) FILTER (WHERE o.stage <> 'cancelled'), 0),
    COALESCE(SUM(ci.qty) FILTER (WHERE o.stage <> 'cancelled' AND (o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))), 0)
  INTO v_crossell_added, v_crossell_converted
  FROM public.order_crossell_items ci
  JOIN public.orders o ON o.id = ci.order_id
  WHERE ci.event_id = p_event_id;

  SELECT
    count(*),
    count(*) FILTER (WHERE source = 'lp'),
    count(*) FILTER (WHERE source = 'typebot')
  INTO v_leads_total, v_leads_lp, v_leads_typebot
  FROM public.event_leads
  WHERE event_id = p_event_id;

  SELECT count(DISTINCT lk.k)
  INTO v_leads_converted
  FROM (
    SELECT DISTINCT public.bc_phone_key(phone) AS k
    FROM public.event_leads
    WHERE event_id = p_event_id AND phone IS NOT NULL
  ) lk
  WHERE lk.k <> '' AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    WHERE o.event_id = p_event_id
      AND o.stage <> 'cancelled'
      AND (o.is_paid OR o.paid_externally OR o.stage = ANY(ARRAY['paid','awaiting_shipping','awaiting_mototaxi','awaiting_pickup','shipped','completed']))
      AND public.bc_phone_key(c.whatsapp) = lk.k
  );

  IF v_leads_total > 0 THEN
    v_conversion := round((v_leads_converted::numeric / v_leads_total) * 100, 1);
  END IF;

  RETURN jsonb_build_object(
    'total_orders', v_total_orders,
    'paid_orders', v_paid_orders,
    'revenue', v_revenue,
    'avg_ticket', round(v_avg_ticket, 2),
    'crossell_added', v_crossell_added,
    'crossell_converted', v_crossell_converted,
    'leads_total', v_leads_total,
    'leads_lp', v_leads_lp,
    'leads_typebot', v_leads_typebot,
    'leads_converted', v_leads_converted,
    'conversion_rate', v_conversion
  );
END;
$function$;