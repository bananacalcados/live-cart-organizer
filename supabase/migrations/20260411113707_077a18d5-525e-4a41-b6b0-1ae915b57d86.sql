
CREATE OR REPLACE FUNCTION public.dedup_outgoing_message(
  p_phone text,
  p_message text,
  p_whatsapp_number_id uuid DEFAULT NULL,
  p_cutoff_minutes integer DEFAULT 5
)
RETURNS TABLE(id uuid, message_id text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT wm.id, wm.message_id
  FROM whatsapp_messages wm
  WHERE RIGHT(regexp_replace(wm.phone, '[^0-9]', '', 'g'), 8) = RIGHT(regexp_replace(p_phone, '[^0-9]', '', 'g'), 8)
    AND wm.direction = 'outgoing'
    AND wm.message = p_message
    AND wm.created_at >= NOW() - (p_cutoff_minutes || ' minutes')::interval
    AND (
      (p_whatsapp_number_id IS NULL AND wm.whatsapp_number_id IS NULL)
      OR wm.whatsapp_number_id = p_whatsapp_number_id
    )
  ORDER BY wm.created_at DESC
  LIMIT 1;
$$;
