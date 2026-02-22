
-- 1. RPC to get conversations summary (replaces loading all 76k+ messages)
CREATE OR REPLACE FUNCTION public.get_conversations(p_number_id UUID DEFAULT NULL)
RETURNS TABLE (
  phone TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count BIGINT,
  direction TEXT,
  is_group BOOLEAN,
  whatsapp_number_id UUID,
  sender_name TEXT,
  status TEXT,
  has_outgoing BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT *
    FROM whatsapp_messages wm
    WHERE (p_number_id IS NULL OR wm.whatsapp_number_id = p_number_id)
  ),
  latest AS (
    SELECT DISTINCT ON (f.phone)
      f.phone,
      f.message AS last_message,
      f.created_at AS last_message_at,
      f.direction,
      f.is_group,
      f.whatsapp_number_id,
      f.sender_name,
      f.status
    FROM filtered f
    ORDER BY f.phone, f.created_at DESC
  ),
  unreads AS (
    SELECT f.phone, COUNT(*) AS unread_count
    FROM filtered f
    WHERE f.direction = 'incoming' AND (f.status IS NULL OR f.status != 'read')
    GROUP BY f.phone
  ),
  has_out AS (
    SELECT DISTINCT f.phone
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
  LEFT JOIN unreads u ON u.phone = l.phone
  LEFT JOIN has_out ho ON ho.phone = l.phone
  ORDER BY l.last_message_at DESC;
$$;

-- 2. RPC to get all allowed modules for a user in one call
CREATE OR REPLACE FUNCTION public.get_user_allowed_modules(p_user_id UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_user_id AND role = 'admin')
    THEN ARRAY['dashboard','events','chat','marketing','expedition','pos','inventory','management','admin']
    ELSE COALESCE(
      (SELECT array_agg(module) FROM user_module_permissions WHERE user_id = p_user_id),
      ARRAY[]::TEXT[]
    )
  END;
$$;
