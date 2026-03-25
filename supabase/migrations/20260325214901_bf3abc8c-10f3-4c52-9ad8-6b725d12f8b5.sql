
-- 1. GRANT EXECUTE on lookup_customer_by_whatsapp (already has SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.lookup_customer_by_whatsapp(text) TO anon, authenticated;

-- 2. Create RPC for whatsapp_messages chat history
CREATE OR REPLACE FUNCTION public.get_customer_chat_history(p_phone text)
RETURNS TABLE(
  id uuid,
  phone text,
  message text,
  direction text,
  created_at timestamptz,
  media_type text,
  media_url text,
  status text,
  whatsapp_number_id uuid,
  sender_name text,
  is_group boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT wm.id, wm.phone, wm.message, wm.direction, wm.created_at,
         wm.media_type, wm.media_url, wm.status, wm.whatsapp_number_id,
         wm.sender_name, wm.is_group
  FROM public.whatsapp_messages wm
  WHERE wm.phone = p_phone
  ORDER BY wm.created_at DESC
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_chat_history(text) TO anon, authenticated;
