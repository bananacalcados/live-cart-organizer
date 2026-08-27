DROP FUNCTION IF EXISTS public.member_area_find_by_identity(uuid, text, text);

CREATE OR REPLACE FUNCTION public.member_area_find_by_identity(
  p_event_id uuid,
  p_kind text,
  p_value text
)
RETURNS TABLE (found_order_id uuid, found_customer_id uuid, matches integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := public.norm_identity_text(p_value);
  v_ids uuid[];
BEGIN
  IF v_norm IS NULL OR length(v_norm) < 3 THEN
    RETURN;
  END IF;

  IF p_kind = 'instagram' THEN
    SELECT array_agg(cu.id) INTO v_ids
    FROM public.customers cu
    WHERE public.norm_identity_text(cu.instagram_handle) = v_norm;
  ELSE
    SELECT array_agg(cu.id) INTO v_ids
    FROM public.customers cu
    WHERE public.norm_identity_text(cu.full_name) = v_norm
       OR public.norm_identity_text(cu.instagram_handle) = v_norm;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT o.id AS oid, o.customer_id AS cid, o.created_at AS created
    FROM public.orders o
    WHERE o.customer_id = ANY(v_ids)
      AND o.stage NOT IN ('cancelled', 'delivered', 'completed')
      AND (p_event_id IS NULL OR o.event_id = p_event_id)
  ), counted AS (
    SELECT count(DISTINCT cand.cid)::int AS n FROM cand
  )
  SELECT cand.oid, cand.cid, counted.n
  FROM cand, counted
  ORDER BY cand.created DESC
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_area_find_by_identity(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_area_find_by_identity(uuid, text, text) TO service_role;