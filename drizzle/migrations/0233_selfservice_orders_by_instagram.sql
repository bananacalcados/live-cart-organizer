CREATE OR REPLACE FUNCTION public.selfservice_orders_by_instagram(p_event_id uuid, p_instagram text, p_phone text)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH h AS (SELECT nullif(lower(regexp_replace(coalesce(p_instagram,''), '^\s*@|\s', '', 'g')), '') AS k)
  SELECT coalesce(array_agg(o.id ORDER BY o.created_at), '{}')
  FROM h JOIN public.orders o ON o.event_id = p_event_id
  JOIN public.customers c ON c.id = o.customer_id
  WHERE h.k IS NOT NULL
    AND nullif(lower(regexp_replace(c.instagram_handle, '^\s*@|\s', '', 'g')), '') = h.k
    AND o.stage <> 'cancelled' AND o.merged_into_order_id IS NULL
    AND coalesce(o.is_paid,false) = false AND coalesce(o.paid_externally,false) = false
    AND (nullif(regexp_replace(coalesce(c.whatsapp,''), '\D', '', 'g'), '') IS NULL
         OR right(regexp_replace(c.whatsapp, '\D', '', 'g'), 8) = right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 8))
$$;
REVOKE ALL ON FUNCTION public.selfservice_orders_by_instagram(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_orders_by_instagram(uuid, text, text) TO service_role;