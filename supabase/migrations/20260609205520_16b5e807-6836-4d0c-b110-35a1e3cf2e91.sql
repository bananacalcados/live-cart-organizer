-- Partial index to speed up scanning of non-dispatch messages in the recent window
CREATE INDEX IF NOT EXISTS idx_wm_created_not_mass_dispatch
  ON public.whatsapp_messages USING btree (created_at DESC)
  WHERE (is_mass_dispatch IS NOT TRUE);

CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id uuid DEFAULT NULL::uuid, p_dispatch_only boolean DEFAULT NULL::boolean)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text, has_incoming boolean)
 LANGUAGE plpgsql
 STABLE
 SET statement_timeout TO '25s'
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH msgs AS MATERIALIZED (
    SELECT
      wm.phone::text AS phone,
      wm.whatsapp_number_id,
      wm.message::text AS message,
      wm.created_at,
      wm.direction::text AS direction,
      wm.is_group,
      wm.sender_name::text AS sender_name,
      wm.status::text AS status,
      wm.is_mass_dispatch,
      wm.channel::text AS channel
    FROM whatsapp_messages wm
    WHERE wm.created_at > NOW() - INTERVAL '14 days'
      AND (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
      -- OPTIMIZATION: when caller asks for regular conversations (p_dispatch_only = false),
      -- skip mass-dispatch (broadcast) outgoing rows at scan time. This drops ~60% of rows.
      -- Incoming client replies are NEVER mass-dispatch, so any chat where the client
      -- replied within the window is fully preserved (covers the "client replied < 4 days" case).
      AND (
        p_dispatch_only IS DISTINCT FROM false
        OR wm.is_mass_dispatch IS NOT TRUE
      )
  ),
  latest AS (
    SELECT DISTINCT ON (m.phone, COALESCE(m.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid))
      m.phone,
      m.message AS last_message,
      m.created_at AS last_message_at,
      m.direction,
      m.is_group,
      m.whatsapp_number_id,
      m.sender_name,
      m.status,
      m.is_mass_dispatch,
      m.channel
    FROM msgs m
    ORDER BY m.phone, COALESCE(m.whatsapp_number_id, '00000000-0000-0000-0000-000000000000'::uuid), m.created_at DESC
  ),
  agg AS (
    SELECT
      m.phone,
      m.whatsapp_number_id,
      COUNT(*) FILTER (WHERE m.direction = 'incoming' AND (m.status IS NULL OR m.status <> 'read')) AS unread_count,
      bool_or(m.direction = 'outgoing') AS has_outgoing,
      bool_or(m.direction = 'incoming') AS has_incoming
    FROM msgs m
    GROUP BY m.phone, m.whatsapp_number_id
  ),
  contact_names AS (
    SELECT DISTINCT ON (m.phone)
      m.phone,
      m.sender_name
    FROM msgs m
    WHERE m.sender_name IS NOT NULL AND m.sender_name <> ''
    ORDER BY m.phone, m.created_at DESC
  ),
  results AS (
    SELECT
      l.phone,
      l.last_message,
      l.last_message_at,
      COALESCE(a.unread_count, 0)::bigint AS unread_count,
      l.direction,
      COALESCE(l.is_group, false) AS is_group,
      l.whatsapp_number_id,
      COALESCE(l.sender_name, cn.sender_name)::text AS sender_name,
      l.status,
      COALESCE(a.has_outgoing, false) AS has_outgoing,
      (
        (l.is_mass_dispatch = true AND l.direction = 'outgoing')
        OR (
          l.direction = 'outgoing'
          AND COALESCE(a.has_incoming, false) = false
          AND (l.channel IS NULL OR l.channel NOT IN ('instagram', 'messenger'))
        )
      ) AS is_dispatch_only,
      l.channel,
      COALESCE(a.has_incoming, false) AS has_incoming
    FROM latest l
    LEFT JOIN agg a ON a.phone = l.phone AND (a.whatsapp_number_id IS NOT DISTINCT FROM l.whatsapp_number_id)
    LEFT JOIN contact_names cn ON cn.phone = l.phone
  )
  SELECT r.* FROM results r
  WHERE CASE
    WHEN p_dispatch_only = true THEN r.is_dispatch_only = true
    WHEN p_dispatch_only = false THEN r.is_dispatch_only = false
    ELSE true
  END
  ORDER BY r.last_message_at DESC;
END;
$function$;