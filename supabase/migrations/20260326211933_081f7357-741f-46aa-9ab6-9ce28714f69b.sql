
DROP FUNCTION public.get_conversations(uuid);

CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text)
 LANGUAGE sql
 STABLE
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
      f.status,
      f.is_mass_dispatch,
      f.channel
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
  ),
  last_dispatch AS (
    SELECT f.phone, f.whatsapp_number_id, MAX(f.created_at) AS last_dispatch_at
    FROM filtered f
    WHERE f.is_mass_dispatch = true AND f.direction = 'outgoing'
    GROUP BY f.phone, f.whatsapp_number_id
  ),
  has_reply_after_dispatch AS (
    SELECT ld.phone, ld.whatsapp_number_id,
      EXISTS (
        SELECT 1 FROM filtered f2
        WHERE f2.phone = ld.phone
          AND (f2.whatsapp_number_id IS NOT DISTINCT FROM ld.whatsapp_number_id)
          AND f2.direction = 'incoming'
          AND f2.created_at > ld.last_dispatch_at
      ) AS has_reply
    FROM last_dispatch ld
  ),
  has_non_dispatch_out_after AS (
    SELECT DISTINCT ld.phone, ld.whatsapp_number_id
    FROM last_dispatch ld
    WHERE EXISTS (
      SELECT 1 FROM filtered f
      WHERE f.phone = ld.phone
        AND (f.whatsapp_number_id IS NOT DISTINCT FROM ld.whatsapp_number_id)
        AND f.direction = 'outgoing'
        AND f.is_mass_dispatch = false
        AND f.created_at > ld.last_dispatch_at
    )
  ),
  conv_channel AS (
    SELECT DISTINCT ON (f.phone, COALESCE(f.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
      f.phone, f.whatsapp_number_id, f.channel
    FROM filtered f
    WHERE f.direction = 'incoming' AND f.channel IS NOT NULL
    ORDER BY f.phone, COALESCE(f.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), f.created_at DESC
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
    (ho.phone IS NOT NULL) AS has_outgoing,
    (l.is_mass_dispatch = true AND l.direction = 'outgoing'
     AND COALESCE(hrad.has_reply, false) = false
     AND hndoa.phone IS NULL) AS is_dispatch_only,
    COALESCE(cc.channel, l.channel) AS channel
  FROM latest l
  LEFT JOIN unreads u ON u.phone = l.phone AND (u.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_out ho ON ho.phone = l.phone AND (ho.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_reply_after_dispatch hrad ON hrad.phone = l.phone AND (hrad.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_non_dispatch_out_after hndoa ON hndoa.phone = l.phone AND (hndoa.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN conv_channel cc ON cc.phone = l.phone AND (cc.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  ORDER BY l.last_message_at DESC;
$function$;
