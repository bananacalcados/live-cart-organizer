CREATE OR REPLACE FUNCTION public.get_conversations_since(
  p_number_id uuid DEFAULT NULL,
  p_dispatch_only boolean DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE(
  phone text, last_message text, last_message_at timestamptz, unread_count bigint,
  direction text, is_group boolean, whatsapp_number_id uuid, sender_name text,
  status text, has_outgoing boolean, is_dispatch_only boolean, channel text,
  has_incoming boolean, last_is_mass_dispatch boolean, updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- MESMA lógica de get_conversations_multi (manter as duas em sincronia),
  -- com filtro opcional por updated_at e devolvendo updated_at.
  -- Dois ramos (UNION ALL) para o plano genérico usar o índice certo em cada caso:
  -- carga completa -> idx_wa_conv_last_at; incremental -> idx_wa_conv_updated_at.
  WITH src AS (
    SELECT c.*
    FROM public.whatsapp_conversations c
    WHERE p_since IS NULL
      AND c.last_message_at > now() - interval '14 days'
      AND (p_number_id IS NULL OR c.whatsapp_number_id = p_number_id)
    UNION ALL
    SELECT u.*
    FROM (
      SELECT c.*
      FROM public.whatsapp_conversations c
      WHERE p_since IS NOT NULL AND c.updated_at > p_since
      OFFSET 0  -- barreira de otimização: força o uso do índice de updated_at
    ) u
    WHERE u.last_message_at > now() - interval '14 days'
      AND (p_number_id IS NULL OR u.whatsapp_number_id = p_number_id)
  ),
  base AS (
    SELECT s.*, (now() - interval '14 days') AS cutoff FROM src s
  ),
  r AS (
    SELECT
      b.phone,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message ELSE b.last_message END AS last_message,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message_at ELSE b.last_message_at END AS last_message_at,
      b.unread_count::bigint AS unread_count,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_direction ELSE b.last_direction END AS direction,
      b.is_group,
      b.whatsapp_number_id,
      b.sender_name,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_status ELSE b.last_status END AS status,
      COALESCE(CASE WHEN p_dispatch_only = false THEN b.nm_last_outgoing_at > b.cutoff ELSE b.last_outgoing_at > b.cutoff END, false) AS has_outgoing,
      COALESCE(b.last_incoming_at > b.cutoff, false) AS has_incoming,
      b.channel,
      CASE WHEN p_dispatch_only = false THEN false ELSE b.last_is_mass_dispatch END AS last_is_mass_dispatch,
      b.updated_at
    FROM base b
    WHERE p_dispatch_only IS DISTINCT FROM false OR b.nm_last_message_at > b.cutoff
  ),
  r2 AS (
    SELECT r.*,
      (
        (r.last_is_mass_dispatch AND r.direction = 'outgoing')
        OR (r.direction = 'outgoing' AND NOT r.has_incoming AND (r.channel IS NULL OR r.channel NOT IN ('instagram', 'messenger')))
      ) AS is_dispatch_only
    FROM r
  )
  SELECT phone, last_message, last_message_at, unread_count, direction, is_group, whatsapp_number_id,
         sender_name, status, has_outgoing, is_dispatch_only, channel, has_incoming, last_is_mass_dispatch, updated_at
  FROM r2
  WHERE CASE
    WHEN p_dispatch_only = true THEN is_dispatch_only
    WHEN p_dispatch_only = false THEN NOT is_dispatch_only
    ELSE true
  END
  ORDER BY last_message_at DESC, phone, whatsapp_number_id
  LIMIT 5000;
$function$;