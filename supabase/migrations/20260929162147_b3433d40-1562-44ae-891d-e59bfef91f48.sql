ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cashback_id uuid, ADD COLUMN IF NOT EXISTS cashback_amount numeric NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_cashback_id ON public.orders(cashback_id) WHERE cashback_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.redeem_order_cashback_on_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cashback_id IS NOT NULL AND NEW.is_paid = true
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_paid,false) = false OR OLD.cashback_id IS DISTINCT FROM NEW.cashback_id) THEN
    UPDATE public.internal_cashback
       SET is_used = true, used_at = now(), used_channel = 'live', used_external_ref = NEW.id::text, updated_at = now()
     WHERE id = NEW.cashback_id AND is_used = false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_redeem_order_cashback_on_paid ON public.orders;
CREATE TRIGGER trg_redeem_order_cashback_on_paid AFTER INSERT OR UPDATE OF is_paid, cashback_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.redeem_order_cashback_on_paid();

-- Cashbacks disponíveis para um pedido (exclui os reservados em outros pedidos abertos)
CREATE OR REPLACE FUNCTION public.available_cashbacks_for_order(p_phone text, p_order_id uuid)
RETURNS TABLE(id uuid, coupon_code text, cashback_amount numeric, min_purchase numeric, expires_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.coupon_code, c.cashback_amount, COALESCE(c.min_purchase,0), c.expires_at, c.created_at
  FROM internal_cashback c
  WHERE auth.uid() IS NOT NULL
    AND length(regexp_replace(coalesce(p_phone,''),'\D','','g')) >= 8
    AND right(regexp_replace(c.customer_phone,'\D','','g'),8) = right(regexp_replace(p_phone,'\D','','g'),8)
    AND c.is_used = false AND c.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.cashback_id = c.id AND o.id <> p_order_id AND o.stage <> 'cancelled')
  ORDER BY c.cashback_amount DESC;
$$;
GRANT EXECUTE ON FUNCTION public.available_cashbacks_for_order(text, uuid) TO authenticated;

-- Quantas pessoas voltaram a comprar depois de usar o cashback
CREATE OR REPLACE FUNCTION public.cashback_return_stats(p_days int DEFAULT 90)
RETURNS TABLE(used_count bigint, customers_used bigint, customers_returned bigint, return_sales bigint, return_revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH used AS (
    SELECT right(regexp_replace(customer_phone,'\D','','g'),8) k, min(used_at) first_used
    FROM internal_cashback
    WHERE auth.uid() IS NOT NULL AND is_used AND used_at >= now() - make_interval(days => p_days)
    GROUP BY 1
  ), ret AS (
    SELECT u.k, count(s.*) n, sum(s.total) rev
    FROM used u JOIN pos_sales s ON s.phone_suffix8 = u.k
      AND s.created_at > u.first_used + interval '1 hour'
      AND coalesce(s.status,'') NOT IN ('cancelled','canceled','cancelada')
    GROUP BY 1
  )
  SELECT (SELECT count(*) FROM internal_cashback WHERE auth.uid() IS NOT NULL AND is_used AND used_at >= now() - make_interval(days => p_days)),
         (SELECT count(*) FROM used), (SELECT count(*) FROM ret),
         (SELECT coalesce(sum(n),0) FROM ret), (SELECT coalesce(sum(rev),0) FROM ret);
$$;
GRANT EXECUTE ON FUNCTION public.cashback_return_stats(int) TO authenticated;