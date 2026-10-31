CREATE UNIQUE INDEX uq_orders_open_catalog_cart ON public.orders(event_id, customer_id)
  WHERE origin = 'catalog' AND is_paid = false AND coalesce(paid_externally,false) = false AND stage <> 'cancelled' AND merged_into_order_id IS NULL;

CREATE OR REPLACE FUNCTION public.catalog_available_cashback(p_phone text, p_order_id uuid)
RETURNS TABLE(id uuid, cashback_amount numeric, min_purchase numeric, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH k AS (SELECT right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10) AS t)
  SELECT c.id, c.cashback_amount, coalesce(c.min_purchase,0), c.expires_at
  FROM internal_cashback c, k
  WHERE length(k.t) = 10
    AND right(regexp_replace(c.customer_phone,'\D','','g'),8) = right(k.t,8)
    AND left(right(regexp_replace(c.customer_phone,'\D','','g'),11),2) IN (left(k.t,2), substr(right(regexp_replace(c.customer_phone,'\D','','g'),10),1,2))
    AND substr(right(regexp_replace(c.customer_phone,'\D','','g'),10),1,2) = left(k.t,2)
       OR (length(regexp_replace(c.customer_phone,'\D','','g')) >= 11 AND left(right(regexp_replace(c.customer_phone,'\D','','g'),11),2) = left(k.t,2) AND right(regexp_replace(c.customer_phone,'\D','','g'),8) = right(k.t,8))
  ORDER BY c.cashback_amount DESC
$$;
REVOKE ALL ON FUNCTION public.catalog_available_cashback(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_available_cashback(text, uuid) TO service_role;