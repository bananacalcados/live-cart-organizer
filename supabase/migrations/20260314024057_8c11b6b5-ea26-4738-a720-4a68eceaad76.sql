
DROP FUNCTION IF EXISTS public.get_orders_by_customer(uuid);

CREATE OR REPLACE FUNCTION public.get_orders_by_customer(p_customer_id uuid)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  customer_id uuid,
  stage text,
  products jsonb,
  is_paid boolean,
  paid_at timestamptz,
  paid_externally boolean,
  free_shipping boolean,
  shipping_cost numeric,
  discount_type text,
  discount_value numeric,
  coupon_code text,
  notes text,
  cart_link text,
  checkout_token text,
  has_unread_messages boolean,
  last_customer_message_at timestamptz,
  last_sent_message_at timestamptz,
  has_gift boolean,
  checkout_started_at timestamptz,
  eligible_for_prize boolean,
  pagarme_order_id text,
  mercadopago_payment_id text,
  appmax_order_id text,
  vindi_transaction_id text,
  created_at timestamptz,
  updated_at timestamptz,
  subtotal numeric,
  discount_applied numeric,
  shipping_applied numeric,
  computed_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.id, o.event_id, o.customer_id, o.stage,
    o.products, o.is_paid, o.paid_at, o.paid_externally,
    o.free_shipping, o.shipping_cost,
    o.discount_type, o.discount_value, o.coupon_code, o.notes,
    o.cart_link, o.checkout_token,
    o.has_unread_messages, o.last_customer_message_at, o.last_sent_message_at,
    o.has_gift, o.checkout_started_at, o.eligible_for_prize,
    o.pagarme_order_id, o.mercadopago_payment_id, o.appmax_order_id, o.vindi_transaction_id,
    o.created_at, o.updated_at,
    COALESCE((
      SELECT SUM( (item->>'price')::numeric * (item->>'quantity')::numeric )
      FROM jsonb_array_elements(o.products) AS item
    ), 0) AS subtotal,
    CASE
      WHEN o.discount_type = 'fixed' THEN COALESCE(o.discount_value, 0)
      WHEN o.discount_type = 'percentage' THEN ROUND(
        COALESCE((
          SELECT SUM( (item->>'price')::numeric * (item->>'quantity')::numeric )
          FROM jsonb_array_elements(o.products) AS item
        ), 0) * COALESCE(o.discount_value, 0) / 100, 2)
      ELSE 0
    END AS discount_applied,
    CASE WHEN o.free_shipping THEN 0 ELSE COALESCE(o.shipping_cost, 0) END AS shipping_applied,
    COALESCE((
      SELECT SUM( (item->>'price')::numeric * (item->>'quantity')::numeric )
      FROM jsonb_array_elements(o.products) AS item
    ), 0)
    - CASE
        WHEN o.discount_type = 'fixed' THEN COALESCE(o.discount_value, 0)
        WHEN o.discount_type = 'percentage' THEN ROUND(
          COALESCE((
            SELECT SUM( (item->>'price')::numeric * (item->>'quantity')::numeric )
            FROM jsonb_array_elements(o.products) AS item
          ), 0) * COALESCE(o.discount_value, 0) / 100, 2)
        ELSE 0
      END
    + CASE WHEN o.free_shipping THEN 0 ELSE COALESCE(o.shipping_cost, 0) END AS computed_total
  FROM orders o
  WHERE o.customer_id = p_customer_id
    AND o.is_paid = false
  ORDER BY o.created_at DESC;
$$;
