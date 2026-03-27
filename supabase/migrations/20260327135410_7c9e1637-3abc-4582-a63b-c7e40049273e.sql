
CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid, p_dispatch_only boolean DEFAULT NULL)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text)
 LANGUAGE plpgsql
 STABLE
 SET statement_timeout TO '25s'
AS $function$
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (wm.phone, COALESCE(wm.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
      wm.phone::text AS phone,
      wm.message::text AS last_message,
      wm.created_at AS last_message_at,
      wm.direction::text,
      wm.is_group,
      wm.whatsapp_number_id,
      wm.sender_name::text,
      wm.status::text,
      wm.is_mass_dispatch,
      wm.channel::text
    FROM whatsapp_messages wm
    WHERE wm.created_at > NOW() - INTERVAL '14 days'
      AND (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
    ORDER BY wm.phone, COALESCE(wm.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), wm.created_at DESC
  ),
  contact_names AS (
    SELECT DISTINCT ON (wm.phone)
      wm.phone::text AS phone,
      wm.sender_name::text AS sender_name
    FROM whatsapp_messages wm
    WHERE wm.sender_name IS NOT NULL AND wm.sender_name != ''
      AND wm.created_at > NOW() - INTERVAL '14 days'
    ORDER BY wm.phone, wm.created_at DESC
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
  ),
  results AS (
    SELECT
      l.phone,
      l.last_message,
      l.last_message_at,
      COALESCE(u.cnt, 0)::bigint AS unread_count,
      l.direction,
      COALESCE(l.is_group, false) AS is_group,
      l.whatsapp_number_id,
      COALESCE(l.sender_name, cn.sender_name)::text AS sender_name,
      l.status,
      (ho.phone IS NOT NULL) AS has_outgoing,
      (l.is_mass_dispatch = true AND l.direction = 'outgoing') AS is_dispatch_only,
      l.channel
    FROM latest l
    LEFT JOIN contact_names cn ON cn.phone = l.phone
    LEFT JOIN unreads u ON u.phone::text = l.phone AND (u.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
    LEFT JOIN has_out ho ON ho.phone::text = l.phone AND (ho.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  )
  SELECT r.* FROM results r
  WHERE 
    CASE 
      WHEN p_dispatch_only = true THEN r.is_dispatch_only = true
      WHEN p_dispatch_only = false THEN r.is_dispatch_only = false
      ELSE true
    END
  ORDER BY r.last_message_at DESC;
END;
$function$;
