
DROP FUNCTION public.get_conversations(uuid);

CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH recent AS (
    SELECT *
    FROM whatsapp_messages wm
    WHERE wm.created_at > NOW() - INTERVAL '30 days'
      AND (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
  ),
  latest AS (
    SELECT DISTINCT ON (r.phone, COALESCE(r.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
      r.phone,
      r.message AS last_message,
      r.created_at AS last_message_at,
      r.direction,
      r.is_group,
      r.whatsapp_number_id,
      r.sender_name,
      r.status,
      r.is_mass_dispatch,
      r.channel
    FROM recent r
    ORDER BY r.phone, COALESCE(r.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), r.created_at DESC
  ),
  unreads AS (
    SELECT r.phone, r.whatsapp_number_id, COUNT(*) AS unread_count
    FROM recent r
    WHERE r.direction = 'incoming' AND (r.status IS NULL OR r.status != 'read')
    GROUP BY r.phone, r.whatsapp_number_id
  ),
  has_out AS (
    SELECT DISTINCT r.phone, r.whatsapp_number_id
    FROM recent r
    WHERE r.direction = 'outgoing'
  ),
  last_dispatch AS (
    SELECT r.phone, r.whatsapp_number_id, MAX(r.created_at) AS last_dispatch_at
    FROM recent r
    WHERE r.is_mass_dispatch = true AND r.direction = 'outgoing'
    GROUP BY r.phone, r.whatsapp_number_id
  ),
  has_reply_after_dispatch AS (
    SELECT ld.phone, ld.whatsapp_number_id,
      EXISTS (
        SELECT 1 FROM recent r2
        WHERE r2.phone = ld.phone
          AND (r2.whatsapp_number_id IS NOT DISTINCT FROM ld.whatsapp_number_id)
          AND r2.direction = 'incoming'
          AND r2.created_at > ld.last_dispatch_at
      ) AS has_reply
    FROM last_dispatch ld
  ),
  has_non_dispatch_out_after AS (
    SELECT DISTINCT ld.phone, ld.whatsapp_number_id
    FROM last_dispatch ld
    WHERE EXISTS (
      SELECT 1 FROM recent r
      WHERE r.phone = ld.phone
        AND (r.whatsapp_number_id IS NOT DISTINCT FROM ld.whatsapp_number_id)
        AND r.direction = 'outgoing'
        AND r.is_mass_dispatch = false
        AND r.created_at > ld.last_dispatch_at
    )
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
    l.channel
  FROM latest l
  LEFT JOIN unreads u ON u.phone = l.phone AND (u.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_out ho ON ho.phone = l.phone AND (ho.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_reply_after_dispatch hrad ON hrad.phone = l.phone AND (hrad.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  LEFT JOIN has_non_dispatch_out_after hndoa ON hndoa.phone = l.phone AND (hndoa.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
  ORDER BY l.last_message_at DESC;
$function$;
