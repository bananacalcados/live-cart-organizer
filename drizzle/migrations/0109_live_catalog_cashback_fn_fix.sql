CREATE OR REPLACE FUNCTION public.catalog_available_cashback(p_phone text, p_order_id uuid)
RETURNS TABLE(id uuid, cashback_amount numeric, min_purchase numeric, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH k AS (
    SELECT CASE WHEN length(d) >= 12 AND left(d,2)='55' THEN substr(d,3) ELSE d END AS n
    FROM (SELECT regexp_replace(coalesce(p_phone,''),'\D','','g') AS d) x
  ), c2 AS (
    SELECT c.*, CASE WHEN length(cd) >= 12 AND left(cd,2)='55' THEN substr(cd,3) ELSE cd END AS n
    FROM internal_cashback c, LATERAL (SELECT regexp_replace(coalesce(c.customer_phone,''),'\D','','g') AS cd) y
    WHERE c.is_used = false AND c.expires_at > now()
  )
  SELECT c2.id, c2.cashback_amount, coalesce(c2.min_purchase,0), c2.expires_at
  FROM c2, k
  WHERE length(k.n) >= 10 AND length(c2.n) >= 10
    AND left(c2.n,2) = left(k.n,2) AND right(c2.n,8) = right(k.n,8)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.cashback_id = c2.id AND o.id IS DISTINCT FROM p_order_id AND o.stage <> 'cancelled')
  ORDER BY c2.cashback_amount DESC
$$;
REVOKE ALL ON FUNCTION public.catalog_available_cashback(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_available_cashback(text, uuid) TO service_role;