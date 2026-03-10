
CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT *
    FROM whatsapp_messages wm
    WHERE (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
  ),
  latest AS (
    SELECT DISTINCT ON (f.phone, COALESCE(f.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
      f.phone,
      f.message AS last_message,
      f.created_at AS last_message_at,
      f.direction,
      f.is_group,
      f.whatsapp_number_id,
      f.sender_name,
      f.status
    FROM filtered f
    ORDER BY f.phone, COALESCE(f.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), f.created_at DESC
  ),
  unreads AS (
    SELECT f.phone, f.whatsapp_number_id, COUNT(*) AS unread_count
    FROM filtered f
    WHERE f.direction = 'incoming' AND (f.status IS NULL OR f.status != 'read')
    GROUP BY f.phone, f.whatsapp_number_id
  ),
  has_out AS (
    SELECT DISTINCT f.phone, f.whatsapp_number_id
    FROM filtered f
    WHERE f.direction = 'outgoing'
  )
  SELECT
    l.phone,
    l.last_message,
    l.last_message_at,
    COALESCE(u.unread_count, 0) AS unread_count,
    l.direction,
    COALESCE(l.is_group, false) AS is_group,
    l.whatsapp_number_id,
    l.sender_name,
    l.status,
    (ho.phone IS NOT NULL) AS has_outgoing
  FROM latest l
  LEFT JOIN unreads u ON u.phone = l.phone AND (u.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_out ho ON ho.phone = l.phone AND (ho.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  ORDER BY l.last_message_at DESC;
$function$
