CREATE OR REPLACE FUNCTION public.claim_event_order_routing(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ok boolean := false;
BEGIN
  UPDATE public.orders
     SET pos_routing_claimed_at = now()
   WHERE id = p_order_id
     AND pos_sale_id IS NULL
     AND (pos_routing_claimed_at IS NULL OR pos_routing_claimed_at < now() - interval '5 minutes');
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_event_order_routing(p_order_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.orders SET pos_routing_claimed_at = NULL
   WHERE id = p_order_id AND pos_sale_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.claim_event_order_routing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_event_order_routing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_order_routing(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_event_order_routing(uuid) TO service_role;