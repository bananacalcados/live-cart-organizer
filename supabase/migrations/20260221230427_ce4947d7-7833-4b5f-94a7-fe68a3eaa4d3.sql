
CREATE OR REPLACE FUNCTION public.get_conversation_counts()
RETURNS TABLE(awaiting_count bigint, new_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH last_msgs AS (
    SELECT DISTINCT ON (phone)
      phone, direction, created_at
    FROM whatsapp_messages
    ORDER BY phone, created_at DESC
  ),
  has_outgoing AS (
    SELECT DISTINCT phone
    FROM whatsapp_messages
    WHERE direction = 'outgoing'
  ),
  finished AS (
    SELECT DISTINCT ON (phone) phone, finished_at
    FROM chat_finished_conversations
    ORDER BY phone, finished_at DESC
  ),
  active AS (
    SELECT lm.phone, lm.direction,
      CASE WHEN ho.phone IS NOT NULL THEN true ELSE false END as has_reply
    FROM last_msgs lm
    LEFT JOIN has_outgoing ho ON ho.phone = lm.phone
    LEFT JOIN finished f ON f.phone = lm.phone
    WHERE lm.direction = 'incoming'
      AND (f.finished_at IS NULL OR f.finished_at < lm.created_at)
  )
  SELECT
    COUNT(*) FILTER (WHERE has_reply) as awaiting_count,
    COUNT(*) FILTER (WHERE NOT has_reply) as new_count
  FROM active;
$$;
