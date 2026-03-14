
CREATE OR REPLACE FUNCTION public.get_orders_by_customer(p_customer_id uuid)
RETURNS TABLE(id uuid, event_id uuid, customer_id uuid, stage text, products jsonb, is_paid boolean, paid_externally boolean, free_shipping boolean, shipping_cost numeric, discount_type text, discount_value numeric, coupon_code text, notes text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT o.id, o.event_id, o.customer_id, o.stage, o.products, o.is_paid, o.paid_externally, o.free_shipping, o.shipping_cost, o.discount_type, o.discount_value, o.coupon_code, o.notes, o.created_at
  FROM orders o
  WHERE o.customer_id = p_customer_id
    AND o.is_paid = false
  ORDER BY o.created_at DESC;
$$;
