
DROP FUNCTION public.get_conversations(uuid);

CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (wm.phone, COALESCE(wm.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
      wm.phone,
      wm.message AS last_message,
      wm.created_at AS last_message_at,
      wm.direction,
      wm.is_group,
      wm.whatsapp_number_id,
      wm.sender_name,
      wm.status,
      wm.is_mass_dispatch,
      wm.channel
    FROM whatsapp_messages wm
    WHERE wm.created_at > NOW() - INTERVAL '14 days'
      AND (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
    ORDER BY wm.phone, COALESCE(wm.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), wm.created_at DESC
  ),
  unreads AS (
    SELECT wm.phone, wm.whatsapp_number_id, COUNT(*) AS cnt
    FROM whatsapp_messages wm
    WHERE wm.created_at > NOW() - INTERVAL '14 days'
      AND wm.direction = 'incoming'
      AND (wm.status IS NULL OR wm.status != 'read')
      AND (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
    GROUP BY wm.phone, wm.whatsapp_number_id
  ),
  has_out AS (
    SELECT DISTINCT wm.phone, wm.whatsapp_number_id
    FROM whatsapp_messages wm
    WHERE wm.created_at > NOW() - INTERVAL '14 days'
      AND wm.direction = 'outgoing'
      AND (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
  )
  SELECT
    l.phone,
    l.last_message,
    l.last_message_at,
    COALESCE(u.cnt, 0)::bigint AS unread_count,
    l.direction,
    COALESCE(l.is_group, false) AS is_group,
    l.whatsapp_number_id,
    l.sender_name,
    l.status,
    (ho.phone IS NOT NULL) AS has_outgoing,
    (l.is_mass_dispatch = true AND l.direction = 'outgoing') AS is_dispatch_only,
    l.channel
  FROM latest l
  LEFT JOIN unreads u ON u.phone = l.phone AND (u.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_out ho ON ho.phone = l.phone AND (ho.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  ORDER BY l.last_message_at DESC;
END;
$function$;
