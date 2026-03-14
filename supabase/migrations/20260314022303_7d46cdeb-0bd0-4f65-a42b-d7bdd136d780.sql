
CREATE OR REPLACE FUNCTION public.lookup_customer_by_whatsapp(p_whatsapp text)
RETURNS TABLE(id uuid, instagram_handle text, whatsapp text, is_banned boolean, tags text[], created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT c.id, c.instagram_handle, c.whatsapp, c.is_banned, c.tags, c.created_at
  FROM customers c
  WHERE right(regexp_replace(c.whatsapp, '[^0-9]', '', 'g'), 8) = right(regexp_replace(p_whatsapp, '[^0-9]', '', 'g'), 8)
  LIMIT 5;
$$;
