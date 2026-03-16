CREATE OR REPLACE FUNCTION public.check_order_ai_paused(p_phone text)
RETURNS TABLE(ai_paused boolean, order_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.ai_paused, o.id as order_id
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE right(regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g'), 8) = right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 8)
    AND o.ai_paused = true
  ORDER BY o.created_at DESC
  LIMIT 1;
$$;