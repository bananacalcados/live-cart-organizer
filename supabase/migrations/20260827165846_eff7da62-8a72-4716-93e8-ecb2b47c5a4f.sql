ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name text;

CREATE OR REPLACE FUNCTION public.norm_identity_text(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    regexp_replace(
      lower(translate(coalesce(p, ''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9]+', ' ', 'g'),
    ' ')
$$;

CREATE INDEX IF NOT EXISTS idx_customers_norm_full_name
  ON public.customers (public.norm_identity_text(full_name));

CREATE INDEX IF NOT EXISTS idx_customers_norm_handle
  ON public.customers (public.norm_identity_text(instagram_handle));

CREATE OR REPLACE FUNCTION public.member_area_find_by_identity(
  p_event_id uuid,
  p_kind text,
  p_value text
)
RETURNS TABLE (order_id uuid, customer_id uuid, matches integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := public.norm_identity_text(p_value);
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_norm IS NULL OR length(v_norm) < 3 THEN
    RETURN;
  END IF;

  IF p_kind = 'instagram' THEN
    SELECT array_agg(c.id) INTO v_ids
    FROM public.customers c
    WHERE public.norm_identity_text(c.instagram_handle) = v_norm;
  ELSE
    SELECT array_agg(c.id) INTO v_ids
    FROM public.customers c
    WHERE public.norm_identity_text(c.full_name) = v_norm
       OR public.norm_identity_text(c.instagram_handle) = v_norm;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT o.id, o.customer_id, o.created_at
    FROM public.orders o
    WHERE o.customer_id = ANY(v_ids)
      AND o.stage NOT IN ('cancelled', 'delivered', 'completed')
      AND (p_event_id IS NULL OR o.event_id = p_event_id)
    ORDER BY o.created_at DESC
  ), counted AS (
    SELECT count(DISTINCT c.customer_id)::int AS n FROM cand c
  )
  SELECT c.id, c.customer_id, counted.n
  FROM cand c, counted
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.member_area_find_by_identity(uuid, text, text) TO service_role;